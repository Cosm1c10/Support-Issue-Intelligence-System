"""
seed_kreo_data.py
=================
Kreo-specific seeding script for the Support Issue Intelligence System.

What this script does:
  1. Generates 270 realistic support tickets tied to actual Kreo products
     (Swarm65, Chimera V2, Owl Webcam, Frost Cooler, Beluga V2, etc.)
  2. Distributes timestamps over the past 60 days with designed trends:
       - Webcam Connectivity Issues  → INCREASING  (Owl launch spike: 28 tickets in 3-day window)
       - Keyboard Connectivity       → INCREASING  (Swarm65 / Hive75 2.4GHz dropouts)
       - Software / Firmware / RGB   → STABLE      (Kreo app + RGB issues)
       - Shipping & Missing Items    → STABLE      (fulfilment errors)
       - Hardware Defects            → DECREASING  (quality improving)
       - Mouse & Controller Issues   → STABLE      (Chimera V2, Surge, SurgeXB)
       - Returns / Warranty          → DECREASING  (fewer claims)
  3. Embeds all tickets via OpenAI text-embedding-3-small
  4. Runs K-Means clustering (k=7) on L2-normalised embeddings
  5. Names each cluster via GPT-4o-mini
  6. Stores everything in Supabase

Usage:
  pip install -r requirements.txt
  cp .env.example .env   # fill SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
  python scripts/seed_kreo_data.py

Re-seeding (idempotent):
  python scripts/seed_kreo_data.py            # truncate + re-seed
  python scripts/seed_kreo_data.py --skip-truncate  # append only
"""

import os, sys, time, json, argparse, random
from datetime import datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
from openai import OpenAI
from supabase import create_client, Client
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ─────────────────────── Config ───────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY   = os.environ["OPENAI_API_KEY"]

EMBEDDING_MODEL = "text-embedding-3-small"
CHAT_MODEL      = "gpt-4o-mini"
N_CLUSTERS      = 7
WINDOW_DAYS     = 30
TREND_THRESHOLD = 0.25

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client    = OpenAI(api_key=OPENAI_KEY)


# ══════════════════════════════════════════════════════
#  TICKET TEMPLATE POOLS
#  Each category has subject/description pools.
#  Descriptions are intentionally messy — real gamers
#  don't proofread their support tickets.
# ══════════════════════════════════════════════════════

WEBCAM_SUBJECTS = [
    "owl webcam not detected on my pc",
    "Owl webcam keeps disconnecting mid stream",
    "owl cam shows black screen in OBS",
    "kreo owl webcam driver not installing",
    "webcam image super blurry after latest update",
    "owl webcam not working on mac",
    "owl webcam randomly freezes during video calls",
    "owl cam not recognized in zoom / teams",
    "Owl HD webcam flickering problem",
    "owl webcam audio and video out of sync",
    "owl webcam loses focus every few minutes",
    "kreo owl cam keeps crashing my streaming setup",
    "webcam showing greenish tint on image",
    "owl webcam not compatible with discord",
    "owl cam usb keeps disconnecting",
    "owl webcam very dark even in good lighting",
    "kreo webcam shutter speed issue at night",
    "owl full hd cam not detected after windows update",
    "owl webcam framerate drops to like 5fps",
    "webcam works for 2 min then dies",
]

WEBCAM_DESCRIPTIONS = [
    "bought the owl webcam last week and it wont even show up in device manager. tried 3 different usb ports. nothing. spent 2 hours trying to fix this pls help",
    "my owl webcam disconnects every 10-15 mins during stream. my entire stream setup gets ruined when it drops out mid session. this is completely unusable for content creation",
    "ok so i use OBS for streaming and the owl cam just shows a black screen. audio works fine but no video. tried reinstalling drivers 4 times. please fix this asap",
    "the driver installer crashes halfway through every single time on windows 11. tried the download from your site twice. same error both times. what is going on with this product",
    "after the firmware update my owl webcam image is super blurry. autofocus is just not working anymore. looked sharp before the update. please rollback or fix",
    "the owl cam doesnt work on my macbook pro m2 at all. shows up as connected but no image in any app. is there a mac driver?? cant find it anywhere on your site",
    "my webcam image freezes completely during google meet calls. happens after about 20-30 mins of use. have to unplug and replug every time which is super annoying",
    "i use zoom for work meetings and the owl cam just doesnt show up as a camera option. shows up in device manager tho. tried uninstalling zoom and reinstalling. no luck",
    "the video feed flickers really badly when theres any movement. almost like its strobing. makes it unwatchable for streaming. checked all settings cant find a fix",
    "bought this for content creation but the audio is always about half a second behind the video. tried adjusting sync offset in obs but it keeps drifting. really frustrating",
    "the autofocus keeps hunting back and forth every few minutes. like it loses focus then refocuses over and over. very distracting during meetings and streams",
    "my entire streaming pc crashes when i unplug the owl cam while its in use. first time it happened i thought my pc was done. this is a serious bug please fix urgently",
    "there's a really noticeable greenish tint on everything in the image. white balance seems stuck. can't fix it in any software. image looks terrible for streaming",
    "discord doesnt detect the owl webcam at all. shows up in windows camera app fine but discord just wont find it. discord support said it should work. is there a fix?",
    "the usb connection drops constantly. i can see the device connect and disconnect in device manager every few minutes. tried different cables and ports. still the same",
    "even in bright room lighting the image is extremely dark. exposure settings in kreo app dont seem to do anything. looks almost night-vision quality in daylight which is wrong",
    "the webcam has really weird shutter speed issues in anything other than direct bright light. gets all blurry with motion blur at night even with ring light. expected better",
    "since the windows update last week the owl cam stopped showing up completely. shows yellow exclamation mark in device manager. tried reinstalling drivers. nothing works",
    "framerate keeps dropping to like 5fps out of nowhere during streams. cpu usage looks fine. no other apps using camera. just randomly tanks the fps and ruins the stream",
    "worked perfectly on day 1. then from day 2 onwards it just disconnects after 2 minutes. sometimes comes back if i unplug and replug but most of the time it just dies",
]

KEYBOARD_SUBJECTS = [
    "swarm65 keeps disconnecting mid game",
    "hive75 2.4ghz dongle not recognized",
    "swarm65 wireless drops every few minutes",
    "keyboard switches to bluetooth randomly during game",
    "kreo swarm65 2.4ghz range is terrible",
    "hive75 hall effect keys registering double inputs",
    "swarm65 rgb turns off after sleep mode",
    "keyboard not detected after pc restart",
    "swarm65 battery dying too fast",
    "wireless keyboard lags in competitive fps games",
    "hive75 num lock keeps turning itself off",
    "swarm65 pairing fails on second device",
    "keyboard firmware update bricked my swarm65",
    "swarm65 volume knob not working",
    "hive75 keys randomly stop registering",
    "swarm65 dongle losing signal through desk",
    "keyboard macro keys not saving settings",
    "swarm65 auto switching devices when phone nearby",
    "hive75 wired mode not working with usb c cable",
    "kreo keyboard not working on ps5",
]

KEYBOARD_DESCRIPTIONS = [
    "my swarm65 disconnects in the middle of ranked games. happens at the worst moments. have to reconnect the dongle every time which means i die in game. this is unacceptable for a gaming keyboard",
    "the 2.4ghz dongle for my hive75 isnt showing up in windows at all. tried every usb port on my pc. no sound, no device manager entry, nothing. the keyboard is completely unusable right now",
    "swarm65 wireless connection drops every 3-5 mins consistently. ive tried repositioning the dongle, changing usb ports, everything. the range seems terrible compared to my old keyboard",
    "while gaming my swarm65 keeps randomly switching to bluetooth mode even though i want it on 2.4ghz. really annoying when it switches modes mid game and causes input lag",
    "the 2.4ghz signal on the swarm65 barely reaches through my desk. my keyboard is maybe 50cm from the dongle and it still drops. expected better performance for this price",
    "my hive75 hall effect switches are registering double keystrokes on w and a keys. makes fps games unplayable since i keep doing random 180 turns. this is a hardware defect",
    "after my pc goes to sleep and wakes back up the rgb on my swarm65 stays off and the keyboard isnt detected. have to manually unplug and replug every single morning",
    "every time i restart my pc the keyboard isnt detected automatically. have to unplug the dongle wait 10 seconds and plug it back in. this is a known issue? please fix",
    "the swarm65 battery is dying in like 4-5 hours with rgb on. the product page says 40 hours. something is very wrong. it was lasting longer when i first got it",
    "there is noticeable input lag on the swarm65 in wireless mode. fine in wired mode. but on 2.4ghz there's a tiny but consistent delay that gets me killed in valorant ranked",
    "my hive75 num lock keeps turning off on its own every few minutes. have to keep pressing it to turn it back on. this makes it unusable for any kind of number work",
    "when i try to pair my swarm65 to a second device via bluetooth it just refuses. shows up in windows bluetooth list but connection always fails. only works with the original device",
    "ran the firmware update from your website and now my swarm65 wont turn on at all. the update failed halfway and now im stuck with a dead keyboard. need urgent help",
    "the volume knob on my swarm65 stopped registering any input. it used to control system volume but now it does nothing. tried reinstalling drivers and resetting keyboard settings",
    "random keys on my hive75 stop registering mid game. usually the shift key or spacebar. comes back after a few seconds but costs me rounds in competitive. really frustrating",
    "the dongle is losing signal whenever my hand passes near the usb cable connecting it. have to use a usb extension cable but even then it drops randomly. feels like shielding issue",
    "my swarm65 macros arent saving. i set them up in the kreo app and they work fine while the app is open but as soon as i close it the macros stop working on the keyboard",
    "my swarm65 keeps disconnecting and connecting back when my phone is on the desk. i think it keeps trying to switch bluetooth devices. never had this issue with my old keyboard",
    "the wired mode on my hive75 doesnt work when i use the included usb c cable. the keyboard lights up but no keystrokes register. only the wireless mode works which is backwards",
    "my swarm65 doesnt work on ps5 at all. just doesnt get detected. i use it for typing in menus. checked kreo website but cant find any info about ps5 compatibility",
]

SOFTWARE_SUBJECTS = [
    "kreo app not detecting chimera v2",
    "rgb lighting not saving in kreo software",
    "firmware update failed on swarm65",
    "kreo app crashes on startup windows 11",
    "dpi settings reset to default after pc restart",
    "kreo software not showing device as connected",
    "cant change polling rate in kreo app",
    "kreo app rgb sync not working",
    "hive75 firmware update stuck at 0%",
    "kreo software missing mac support",
    "custom profiles not syncing to keyboard",
    "kreo app high cpu usage in background",
    "macro editor not working in kreo software",
    "chimera v2 buttons not remappable in app",
    "kreo app shows device offline when its connected",
    "onboard memory not saving rgb profiles",
    "software update loop keeps restarting",
    "kreo app freezes when switching profiles",
    "scroll wheel mapping not available in software",
    "kreo lighting effects not animating",
]

SOFTWARE_DESCRIPTIONS = [
    "the kreo app literally doesnt detect my chimera v2 at all. mouse is working fine in windows but the app just says no device found. tried reinstalling the app 3 times already",
    "i set up my rgb lighting exactly how i want it in the kreo software but every time i restart my pc it goes back to the rainbow cycle default. the settings are not saving",
    "tried to update firmware on my swarm65 through the kreo app. update started then failed at 67% with an error. now keyboard rgb is just stuck on white and some keys dont work",
    "the kreo software crashes immediately on startup on my windows 11 machine. just shows the loading screen then disappears. tried running as admin. tried clean reinstall. same result",
    "my chimera v2 dpi settings keep resetting to 800dpi every time i restart my pc. the kreo app shows my settings but they dont actually stick to the mouse. super annoying",
    "kreo app installed fine but shows my swarm65 as not connected even though the keyboard is literally working right now. the app must have a detection bug with the new firmware",
    "i want to change the polling rate on my chimera v2 from 500hz to 1000hz but the option is greyed out in the kreo app. not sure if its a bug or if my device doesnt support it",
    "rgb sync between my swarm65 and chimera v2 doesnt work in the kreo app. they both show connected but the sync option just does nothing. both devices keep doing their own thing",
    "firmware update on my hive75 has been stuck at 0% for 30 minutes. the keyboard still works but im scared to unplug it in case it bricks. what do i do? please help fast",
    "i bought the swarm65 specifically to use with my macbook. the website says mac compatible but there is literally no mac version of the kreo app anywhere. how am i supposed to configure it",
    "i created 3 custom profiles in the kreo app but only profile 1 actually loads onto the keyboard. profiles 2 and 3 dont sync. really annoying for switching between gaming and work",
    "the kreo app is using like 15-20% cpu constantly even when im not using it at all. had to kill the process to play games properly. please optimise the background process",
    "the macro editor in kreo software doesnt work properly. when i try to record a macro it either records nothing or records way too much input. the timing is completely off",
    "the chimera v2 side buttons cant be remapped at all in the kreo app. the only option for them is to reset to defaults. i want to bind them to forward/back in browser. basic feature",
    "kreo app keeps showing my mouse as offline even though i can see it moving the cursor. have to restart the app 5-6 times before it finally detects the device. really frustrating",
    "the onboard memory on my swarm65 isnt storing my rgb profiles. when i disconnect from pc and use in wired mode the lighting just goes to default. onboard memory seems broken",
    "kreo app keeps popping up a message saying an update is available. i click update. it downloads. then asks me to restart. after restart it says update available again. infinite loop",
    "the kreo software completely freezes for about 10 seconds whenever i switch between profiles. entire pc becomes unresponsive. my specs are rtx 4070 and ryzen 7 so its not hardware",
    "cant remap the scroll wheel click to anything useful in the kreo app. the scroll wheel button doesnt even appear in the button mapping screen. seems like it was forgotten",
    "the breathing and wave rgb effects on my swarm65 are not animating at all. they just show a static color. solid colors work but any animated effect is just stuck on one frame",
]

SHIPPING_SUBJECTS = [
    "received keyboard but dongle is missing from box",
    "order arrived but mouse feet not included",
    "braided cable missing from swarm65 box",
    "wrong product delivered - got hive75 ordered swarm65",
    "order shows delivered but nothing received",
    "chimera v2 arrived damaged in broken packaging",
    "missing usb c cable in hive75 box",
    "received empty box - owl webcam missing",
    "ordered white chimera v2 got black one",
    "frost cooler arrived with cracked clip out of box",
    "mouse skates missing from chimera v2 box",
    "delivered to wrong address",
    "beluga v2 headset missing 3.5mm cable",
    "ordered bundle but only got mouse no keyboard",
    "tracking shows delivered but my neighbor got it",
    "owl webcam box was opened and resealed",
    "got duplicate item but one part of order missing",
    "swarm65 box had no foam padding items were loose",
    "order stuck at nimbuspost facility for 8 days",
    "swift delivery charged but standard shipping used",
]

SHIPPING_DESCRIPTIONS = [
    "just opened my swarm65 box and the 2.4ghz dongle is completely missing. no dongle anywhere in the box. without the dongle i cant use the keyboard wirelessly at all. please send replacement asap",
    "received my chimera v2 mouse but theres no replacement mouse feet in the box. the website clearly shows the box contents include spare mouse feet. mine werent there. need them sent",
    "the swarm65 box mentions a braided usb c cable but there was no cable in my box. just the keyboard and a tiny manual. how am i supposed to use it wired? please ship the cable",
    "i ordered the swarm65 black purple but received the hive75 wired instead. completely wrong product. i need the correct item sent out immediately and return label for the wrong one",
    "my order was marked as delivered yesterday but i have received absolutely nothing. checked with building security and neighbours. package is nowhere. order #KR-28471",
    "the chimera v2 box arrived completely crushed. the mouse inside has a crack on the right side. packaging was very thin and clearly insufficient for shipping. need replacement",
    "opened my hive75 box and the usb c cable is missing. i know it should be included because the product page lists it. box looks like it may have been tampered with. please investigate",
    "i ordered an owl full hd webcam and received an empty box. just the manual and nothing else. the webcam is literally not in the box. this is extremely frustrating please help",
    "i specifically ordered the white chimera v2 and paid for it. what arrived is the black version. different colour completely. need the white one sent out please with return label",
    "my frost mobile cooler arrived and one of the phone clips was cracked/snapped before i even opened the box. box looked fine outside but clip was broken inside. requesting exchange",
    "there are no replacement mouse skates in the chimera v2 box. the product listing shows them included in the box. mine was definitely not there. need them replaced please",
    "my order was delivered to the completely wrong address. i can see on the courier app that it was delivered to block b but i am block d. now i cant get my package. need urgent help",
    "the beluga v2 headset arrived without the 3.5mm audio cable that is supposed to be in the box. i need it for my phone and console. please send the missing cable",
    "i ordered the swarm65 and chimera v2 bundle deal. only the mouse arrived. the keyboard is missing from the shipment entirely. tracking shows one package delivered but two items ordered",
    "my courier app shows delivered and even has a photo but the photo shows my neighbors door not mine. my neighbor says they havent received anything either. this is a mess please help",
    "the owl webcam box i received has clearly been opened and resealed with different tape. on top of that the webcam doesnt work properly. i think this is a returned/refurbished unit. not okay",
    "i received two of the same mouse skates in my order but the swarm65 keycap puller that was supposed to come with my keycap set is missing. something went wrong with packing",
    "my swarm65 box had absolutely no foam or padding inside. the keyboard was just floating loose in the box. thankfully nothing is damaged but this is very poor packaging",
    "my order has been sitting at the nimbuspost sorting facility for 8 days now with no movement. the tracking just says in transit at facility. order id #KR-29104. urgent please",
    "i paid for swift delivery 2-3 days but tracking shows the same standard shipping timeline. feels like i was charged for express but got regular. please check and refund difference",
]

HARDWARE_SUBJECTS = [
    "chimera v2 left click double clicking",
    "swarm65 key cap broke off during use",
    "frost mobile cooler fan stopped working",
    "beluga v2 headset left ear cup no audio",
    "chimera v2 scroll wheel feels scratchy",
    "hawk mouse right click not registering",
    "hive75 spacebar makes loud rattling noise",
    "arma mouse feet came off after 1 week",
    "frost cooler suction clip snapped",
    "beluga v2 headset band cracked",
    "chimera v2 sensor skipping at high speed",
    "owl webcam mount broke on first use",
    "sonik mic falling off stand constantly",
    "swarm65 stabilizer very wobbly",
    "surge controller left stick drifting",
    "kast microphone plastic cracked near base",
    "hive75 usb c port feels loose",
    "chimera v2 side buttons hard to press",
    "beluga v2 ear pads peeling after 3 weeks",
    "surge ultra bumpers are unresponsive",
]

HARDWARE_DESCRIPTIONS = [
    "my chimera v2 left click has started double clicking on every single click. it registers two clicks when i only click once. this is making games and normal pc use extremely difficult",
    "one of the keycaps on my swarm65 literally snapped off while i was typing normally. the stem underneath the cap is broken. the key still registers sometimes but falls off constantly",
    "the fan in my frost mobile cooler stopped spinning completely after 2 weeks of use. when i connect it to power the light comes on but the fan doesnt move at all. useless without the fan",
    "the left ear cup on my beluga v2 headset suddenly stopped producing any audio. right side works perfectly. left is completely dead. tried on multiple devices same issue. clearly hardware failure",
    "the scroll wheel on my chimera v2 feels incredibly rough and scratchy when scrolling. also sometimes skips steps when scrolling slowly. it was smooth when i first got it. quality issue",
    "my hawk gaming mouse right click is not registering about 30% of the time. have to click 2-3 times to get one response. in fps games this gets me killed constantly. defective unit",
    "my hive75 spacebar has an incredibly loud rattling/clacking sound when pressed. all other keys are perfect but the spacebar sounds broken. i type a lot and this is really distracting",
    "the mouse feet on my arma 49g came off after just one week of use. not from abuse just normal gaming. the adhesive quality seems really poor. mouse now scratches my mousepad badly",
    "the clip on my frost mobile cooler snapped completely off. i was just attaching it to my phone normally and it snapped. really cheap plastic. cooler is now useless since it cant attach",
    "the headband on my beluga v2 cracked right at the adjustment slider on the left side. i dont use rough with it at all. just normal adjustment and it cracked. this is build quality issue",
    "the chimera v2 sensor starts skipping/stuttering when i do fast swipes. cursor just jumps around at high mouse speed. tried different surfaces and different sensitivity settings. still skips",
    "the monitor clip/mount that comes with the owl webcam broke on literally the first day. i mounted it gently and the plastic just cracked at the mounting point. need a replacement mount",
    "my sonik gaming mic keeps falling off the stand. the connection between mic and stand is very loose and doesnt lock properly. any slight bump and the mic falls over. not usable like this",
    "the spacebar stabilizer on my swarm65 is extremely wobbly side to side. much worse than any other keyboard ive used. i can see it visibly shake while typing. fix or send replacement",
    "my surge ultra controller left stick started drifting upward on its own after 3 weeks of use. character walks forward by itself in games. this seems like a hardware defect",
    "the plastic on my kast microphone cracked near the base where the cable connects. i did nothing unusual just normal desk setup. the crack looks like a stress fracture from the factory",
    "the usb c port on my hive75 feels very loose and wobbly. the cable doesnt sit securely. if i accidentally brush the cable the connection drops. feels like the port will fail soon",
    "the side buttons on my chimera v2 require way too much force to press. they feel like they need serious effort to click which ruins gaming. seems like stiff switches that need replacement",
    "the ear pad material on my beluga v2 has started peeling and flaking after only 3 weeks. the fake leather is just coming apart. i dont use it roughly. this is very poor material quality",
    "the bumper buttons on my surge ultra controller are barely responsive. have to press them very hard and sometimes still dont register. in racing games this is a huge problem",
]

MOUSE_CONTROLLER_SUBJECTS = [
    "chimera v2 wireless not connecting",
    "surge ultra controller random disconnects",
    "arma mouse cursor jumping randomly",
    "surgeXB keeps desyncing from receiver",
    "chimera v2 dpi button not working",
    "mirage controller rgb not turning on",
    "hawk mouse not detected on new pc",
    "surge ultra triggers feel unresponsive",
    "chimera v2 battery indicator wrong",
    "surgeXB wont pair with xbox series x",
    "arma mouse right side button broken",
    "mirage controller vibration too strong",
    "chimera v2 takes forever to pair",
    "surge controller not working in steam",
    "hawk mouse polling rate issue in valorant",
    "surgeXB dock not charging controller",
    "chimera v2 sensor stuttering on glass desk",
    "mirage controller left stick not calibrated",
    "surge ultra not recognized on ps5",
    "chimera v2 sleep mode disconnects too fast",
]

MOUSE_CONTROLLER_DESCRIPTIONS = [
    "my chimera v2 wireless version refuses to connect to my pc. the 2.4ghz dongle is in but the mouse just wont pair. the light on the mouse blinks but never shows as connected. need help",
    "my surge ultra controller keeps randomly disconnecting every 20-30 minutes while gaming. it vibrates once then turns off. have to turn it back on every time. makes gaming very frustrating",
    "the cursor on my arma mouse randomly jumps to a corner of the screen every few minutes. happens even when im not touching the mouse. seems like a sensor or static issue. very distracting",
    "my surgeXB controller keeps desyncing from the wireless receiver. it works fine for 10 minutes then loses connection. have to unplug receiver and replug to get it working again",
    "the dpi switch button on my chimera v2 stopped working entirely. it used to cycle through dpi settings but now pressing it does nothing. stuck on whatever dpi it was last set to",
    "the rgb on my mirage controller wont turn on at all. all other functions work fine but the rgb is completely dead. it was working on day 1 but stopped after i updated the firmware",
    "my hawk mouse isnt being detected on my new ryzen build. it works perfectly on my old pc but on the new one it shows up in device manager with an error. tried reinstalling drivers",
    "the triggers on my surge ultra feel extremely unresponsive. i have to press them almost completely down before they register any input. in racing games this makes throttle control impossible",
    "the battery indicator on my chimera v2 wireless is completely wrong. shows full battery then randomly says 5% and the mouse dies. i cant trust when to charge it now",
    "my surgeXB controller refuses to pair with my xbox series x. tried following the pairing instructions multiple times. the controller pairs fine with pc but not the console. need fix",
    "the right side thumb button on my arma mouse stopped clicking. it still feels like it clicks physically but no input registers. the other side button works fine. hardware failure",
    "the vibration on my mirage controller is insanely strong even on the lowest setting. makes my hand go numb after extended gaming sessions. needs a proper lower setting or option to disable",
    "my chimera v2 wireless takes 3-4 minutes to pair every single time i turn it on. have to sit there clicking the pairing button repeatedly until it finally connects. should be instant",
    "my surge ultra controller is not being recognized by steam at all. shows up in windows game controllers but steam says no controller connected. tried every controller config in steam settings",
    "my hawk mouse polling rate seems to be stuck at 125hz despite being set to 1000hz in the kreo app. causes very noticeable cursor stuttering in valorant. my previous mouse had no issues",
    "the dock that came with my surgeXB controller is not charging the controller at all. the dock light comes on but the controller battery doesnt charge. bought it specifically for this feature",
    "my chimera v2 sensor stutters and loses tracking on my glass desk. i know glass is hard for optical sensors but your website says it works on most surfaces. doesnt work at all on mine",
    "the left stick on my mirage controller drifts very slightly downward when at rest. not huge but in precise games it keeps moving my character slowly. needs calibration or stick replacement",
    "my surge ultra doesnt get recognized on ps5 at all. i know its primarily an xbox/pc controller but i saw on reddit that it can work on ps5. any chance of ps5 support being added?",
    "the chimera v2 goes to sleep after like 30 seconds of not moving and takes ages to wake up. i lose cursor position every time. the sleep timer needs to be longer or configurable",
]

RETURNS_SUBJECTS = [
    "want to return swarm65 within 7 days",
    "chimera v2 defective need warranty replacement",
    "requesting refund for owl webcam",
    "beluga v2 headset warranty claim",
    "frost cooler warranty - fan dead after 2 weeks",
    "want to exchange wrong product received",
    "hive75 keys defective warranty claim",
    "return request - kreo product not as described",
    "refund not received after 3 weeks",
    "warranty repair status not updated",
    "price drop after i bought - want price match",
    "return label not received for defective item",
    "surge ultra warranty - stick drift from week 3",
    "cancelled order still being processed",
    "want to upgrade to chimera v2 from chimera v1",
    "beluga v2 ear pads warranty claim",
    "return window passed but product defective",
    "warranty card not included in product box",
    "exchange swarm65 for different switch type",
    "refund status unknown order kr-29944",
]

RETURNS_DESCRIPTIONS = [
    "i want to return my swarm65 within the 7 day return window. the wireless performance is not what i expected. order number KR-28819. please send me return instructions and label",
    "my chimera v2 double clicks on every left click. this is clearly a manufacturing defect. the mouse is 6 weeks old and well within warranty. requesting immediate replacement please",
    "i want a full refund for my owl webcam. it has never worked properly since i received it. drivers dont install correctly and device is not detected. tried everything. want my money back",
    "my beluga v2 left ear cup died after 5 weeks of use. well within the 1 year warranty period. requesting warranty replacement. the headset is otherwise in perfect condition",
    "the fan in my frost cooler stopped working after 2 weeks. this is a clear product defect and falls under warranty. requesting replacement unit. still have original box and invoice",
    "i received the wrong product (hive75 instead of swarm65). i want to exchange it for the correct item. please send exchange instructions and a prepaid return label quickly",
    "several keys on my hive75 have started double registering or not registering at all. the keyboard is 2 months old. this falls under the warranty. please initiate warranty process",
    "the product description says the chimera v2 has braided cable but mine has a plain rubber cable. this is not what i paid for. requesting either correct product or partial refund",
    "i returned my defective owl webcam 3 weeks ago and my refund still hasnt shown up. you confirmed receipt of return. tracking confirms delivery. where is my refund? order KR-27203",
    "i sent my swarm65 for warranty repair 4 weeks ago. the status on your website still shows received and not in process. no communication from your team. can someone update me please",
    "i bought my chimera v2 last week for 1999 and today i see it on your site for 1499. can you match the current price and refund the difference? happy to share order details",
    "i was told a return label would be emailed within 24 hours for my defective beluga v2. that was 5 days ago. still no email. checked spam. nothing there. please resend the return label",
    "my surge ultra controller developed stick drift after just 3 weeks. i game maybe 1-2 hours a day so this is definitely a defect. need warranty replacement controller",
    "i cancelled my order within 10 minutes of placing it but the payment was still processed. my bank shows the charge. please confirm cancellation and initiate refund. order KR-30012",
    "i have the original chimera v1 and want to upgrade to v2. is there any upgrade pricing or trade-in program? would prefer to exchange at a discounted rate rather than full price",
    "the ear pad material on my beluga v2 is peeling and flaking after 3 weeks of normal use. this is a material quality defect. requesting replacement ear pads or full warranty claim",
    "my swarm65 has a dead key and my 7 day return window just passed 2 days ago. the issue started after the return window. this is a manufacturing defect and should still be covered",
    "i just noticed my chimera v2 box didnt include a warranty card. how do i register for warranty without the card? dont want to lose warranty coverage. please advise",
    "i bought the swarm65 with linear switches but want to exchange for the tactile version. i havent even opened the box yet. is an exchange possible before activation?",
    "my refund for order KR-29944 has been pending for unknown time. i cant see any status update. the order was returned as instructed. please look into this urgently",
]


# ══════════════════════════════════════════════════════
#  TEMPORAL DESIGN
#  Carefully crafted to produce designed trends after
#  the 30-day window split.
#
#  OWL WEBCAM SPIKE:
#    prev window (31-60 days ago): 8 tickets
#    current window (0-30 days ago): 38 tickets total
#      — 28 of those in days 10-13 (the "bad batch" spike)
#      — 10 spread across rest of current window
#    → trend: +375%  →  INCREASING (very dramatic for demo)
#
#  KEYBOARD CONNECTIVITY:
#    prev: 9 → curr: 27 → +200% INCREASING
#
#  SOFTWARE/RGB:
#    prev: 20 → curr: 22 → +10% STABLE
#
#  SHIPPING & MISSING:
#    prev: 17 → curr: 18 → +6% STABLE
#
#  HARDWARE DEFECTS:
#    prev: 22 → curr: 11 → -50% DECREASING
#
#  MOUSE & CONTROLLER:
#    prev: 17 → curr: 18 → +6% STABLE
#
#  RETURNS / WARRANTY:
#    prev: 16 → curr: 8 → -50% DECREASING
# ══════════════════════════════════════════════════════

def generate_tickets_for_category(
    category: str,
    subjects: list,
    descriptions: list,
    product_area: str,
    ticket_type: str,
    days_ago_list: list,
    priority_weights: dict,
    start_ticket_num: int,
) -> list[dict]:
    """
    Generate ticket dicts for one category by sampling from subject/description pools.
    Each ticket gets a timestamp from days_ago_list (one per ticket).
    """
    priorities = list(priority_weights.keys())
    weights = list(priority_weights.values())

    tickets = []
    for i, d_ago in enumerate(days_ago_list):
        subj = random.choice(subjects)
        desc = random.choice(descriptions)
        priority = random.choices(priorities, weights=weights, k=1)[0]
        tickets.append({
            "_category": category,
            "_days_ago": d_ago,
            "subject": subj,
            "description": desc,
            "priority": priority,
            "ticket_type": ticket_type,
            "product_area": product_area,
            "_ticket_num": start_ticket_num + i,
        })
    return tickets


def build_raw_tickets() -> list[dict]:
    random.seed(2024)  # reproducible subject/description sampling

    all_tickets = []
    num = 1000  # starting ticket number

    # ── 1. WEBCAM ISSUES (8 prev + 38 curr = 46 tickets) ──────────────────────
    # prev: 8 tickets spread across days 31-60
    webcam_prev_days = [random.randint(31, 60) for _ in range(8)]
    # curr: 28 spike tickets in days 10-13 + 10 spread across days 1-30
    webcam_spike_days  = [random.randint(10, 13) for _ in range(28)]
    webcam_spread_days = [random.randint(1, 9) for _ in range(5)] + [random.randint(14, 29) for _ in range(5)]
    webcam_days = webcam_prev_days + webcam_spike_days + webcam_spread_days

    batch = generate_tickets_for_category(
        category="webcam_issues",
        subjects=WEBCAM_SUBJECTS,
        descriptions=WEBCAM_DESCRIPTIONS,
        product_area="Webcam",
        ticket_type="Technical Issue",
        days_ago_list=webcam_days,
        priority_weights={"High": 40, "Critical": 20, "Medium": 35, "Low": 5},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)
    num += len(batch)

    # ── 2. KEYBOARD CONNECTIVITY (9 prev + 27 curr = 36 tickets) ───────────────
    kb_prev_days = [random.randint(31, 60) for _ in range(9)]
    kb_curr_days = [random.randint(1, 30) for _ in range(27)]
    kb_days = kb_prev_days + kb_curr_days

    batch = generate_tickets_for_category(
        category="keyboard_connectivity",
        subjects=KEYBOARD_SUBJECTS,
        descriptions=KEYBOARD_DESCRIPTIONS,
        product_area="Keyboard",
        ticket_type="Technical Issue",
        days_ago_list=kb_days,
        priority_weights={"High": 45, "Critical": 15, "Medium": 35, "Low": 5},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)
    num += len(batch)

    # ── 3. SOFTWARE / FIRMWARE / RGB (20 prev + 22 curr = 42 tickets) ──────────
    sw_prev_days = [random.randint(31, 60) for _ in range(20)]
    sw_curr_days = [random.randint(1, 30) for _ in range(22)]
    sw_days = sw_prev_days + sw_curr_days

    batch = generate_tickets_for_category(
        category="software_rgb",
        subjects=SOFTWARE_SUBJECTS,
        descriptions=SOFTWARE_DESCRIPTIONS,
        product_area="Software",
        ticket_type="Bug Report",
        days_ago_list=sw_days,
        priority_weights={"High": 30, "Critical": 10, "Medium": 50, "Low": 10},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)
    num += len(batch)

    # ── 4. SHIPPING & MISSING ITEMS (17 prev + 18 curr = 35 tickets) ───────────
    sh_prev_days = [random.randint(31, 60) for _ in range(17)]
    sh_curr_days = [random.randint(1, 30) for _ in range(18)]
    sh_days = sh_prev_days + sh_curr_days

    batch = generate_tickets_for_category(
        category="shipping_missing",
        subjects=SHIPPING_SUBJECTS,
        descriptions=SHIPPING_DESCRIPTIONS,
        product_area="Logistics",
        ticket_type="Fulfillment Issue",
        days_ago_list=sh_days,
        priority_weights={"High": 35, "Critical": 5, "Medium": 45, "Low": 15},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)
    num += len(batch)

    # ── 5. HARDWARE DEFECTS (22 prev + 11 curr = 33 tickets) ───────────────────
    hw_prev_days = [random.randint(31, 60) for _ in range(22)]
    hw_curr_days = [random.randint(1, 30) for _ in range(11)]
    hw_days = hw_prev_days + hw_curr_days

    batch = generate_tickets_for_category(
        category="hardware_defects",
        subjects=HARDWARE_SUBJECTS,
        descriptions=HARDWARE_DESCRIPTIONS,
        product_area="Hardware",
        ticket_type="Defect Report",
        days_ago_list=hw_days,
        priority_weights={"High": 35, "Critical": 20, "Medium": 40, "Low": 5},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)
    num += len(batch)

    # ── 6. MOUSE & CONTROLLER ISSUES (17 prev + 18 curr = 35 tickets) ──────────
    mc_prev_days = [random.randint(31, 60) for _ in range(17)]
    mc_curr_days = [random.randint(1, 30) for _ in range(18)]
    mc_days = mc_prev_days + mc_curr_days

    batch = generate_tickets_for_category(
        category="mouse_controller",
        subjects=MOUSE_CONTROLLER_SUBJECTS,
        descriptions=MOUSE_CONTROLLER_DESCRIPTIONS,
        product_area="Mouse/Controller",
        ticket_type="Technical Issue",
        days_ago_list=mc_days,
        priority_weights={"High": 40, "Critical": 15, "Medium": 40, "Low": 5},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)
    num += len(batch)

    # ── 7. RETURNS / WARRANTY (16 prev + 8 curr = 24 tickets) ──────────────────
    rw_prev_days = [random.randint(31, 60) for _ in range(16)]
    rw_curr_days = [random.randint(1, 30) for _ in range(8)]
    rw_days = rw_prev_days + rw_curr_days

    batch = generate_tickets_for_category(
        category="returns_warranty",
        subjects=RETURNS_SUBJECTS,
        descriptions=RETURNS_DESCRIPTIONS,
        product_area="Returns",
        ticket_type="Return/Warranty",
        days_ago_list=rw_days,
        priority_weights={"High": 30, "Critical": 5, "Medium": 50, "Low": 15},
        start_ticket_num=num,
    )
    all_tickets.extend(batch)

    print(f"  Total tickets prepared: {len(all_tickets)}")
    return all_tickets


# ─────────────────────── Helpers ───────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def days_ago(n: int) -> datetime:
    jitter_hours = random.uniform(-3, 3)
    return now_utc() - timedelta(days=n, hours=jitter_hours)


def embed_texts(texts: list[str]) -> list[list[float]]:
    print(f"  Generating embeddings for {len(texts)} texts …")
    embeddings = []
    batch_size = 20
    for i in range(0, len(texts), batch_size):
        batch = texts[i: i + batch_size]
        response = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        embeddings.extend([item.embedding for item in response.data])
        print(f"    Embedded {min(i + batch_size, len(texts))}/{len(texts)}")
        if i + batch_size < len(texts):
            time.sleep(0.3)
    return embeddings


def name_cluster(ticket_subjects: list[str]) -> tuple[str, str]:
    subjects_text = "\n".join(f"- {s}" for s in ticket_subjects[:6])
    prompt = (
        "You are an expert at categorising support tickets for Kreo, a D2C gaming peripherals brand.\n"
        "Kreo products include: Swarm65 keyboard, Hive75 keyboard, Chimera V2 mouse, Hawk mouse, "
        "Arma mouse, Surge Ultra controller, SurgeXB controller, Mirage controller, "
        "Owl Full HD Webcam, Beluga V2 headphones, Sonik mic, Kast microphone, Frost Mobile Cooler.\n\n"
        "Given the following support ticket subjects from a single issue cluster, provide:\n"
        "1. A short, clear issue name (3–5 words, title case, no punctuation)\n"
        "2. A one-sentence description of the underlying problem\n\n"
        f"Ticket subjects:\n{subjects_text}\n\n"
        "Respond in JSON with keys 'name' and 'description' only."
    )
    response = openai_client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    data = json.loads(response.choices[0].message.content)
    return data["name"], data["description"]


def calculate_trend(prev: int, curr: int) -> str:
    if prev == 0:
        return "Increasing" if curr > 0 else "Stable"
    ratio = (curr - prev) / prev
    if ratio > TREND_THRESHOLD:
        return "Increasing"
    elif ratio < -TREND_THRESHOLD:
        return "Decreasing"
    return "Stable"


# ─────────────────────── Pipeline ───────────────────────

def truncate_tables():
    print("\n[1/6] Truncating existing data …")
    supabase.table("cluster_members").delete().neq("ticket_id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("issue_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("tickets").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("   Done.")


def insert_tickets_with_embeddings(raw_tickets: list[dict]) -> list[dict]:
    print(f"\n[2/6] Inserting {len(raw_tickets)} Kreo tickets with embeddings …")

    embed_inputs = [f"{t['subject']}. {t['description']}" for t in raw_tickets]
    embeddings = embed_texts(embed_inputs)

    rows = []
    for i, ticket in enumerate(raw_tickets):
        row = {
            "ticket_id":    f"KR-{ticket['_ticket_num']}",
            "subject":      ticket["subject"],
            "description":  ticket["description"],
            "priority":     ticket["priority"],
            "ticket_type":  ticket["ticket_type"],
            "product_area": ticket["product_area"],
            "status":       "Open",
            "created_at":   days_ago(ticket["_days_ago"]).isoformat(),
            "embedding":    embeddings[i],
        }
        rows.append(row)

    batch_size = 20
    inserted = []
    for i in range(0, len(rows), batch_size):
        batch = rows[i: i + batch_size]
        result = supabase.table("tickets").upsert(batch, on_conflict="ticket_id").execute()
        inserted.extend(result.data)
        print(f"   Upserted {min(i + batch_size, len(rows))}/{len(rows)} tickets")

    print(f"   ✓ {len(inserted)} tickets inserted.")
    return inserted


def parse_embedding(value) -> list[float]:
    if isinstance(value, str):
        return json.loads(value)
    return value


def fetch_tickets_with_embeddings() -> tuple[list[dict], np.ndarray]:
    print("\n[3/6] Fetching embeddings from Supabase for clustering …")
    result = supabase.table("tickets").select(
        "id, ticket_id, subject, description, priority, product_area, created_at, embedding"
    ).execute()
    tickets = result.data
    matrix = np.array([parse_embedding(t["embedding"]) for t in tickets], dtype=np.float32)
    print(f"   Fetched {len(tickets)} tickets, shape: {matrix.shape}")
    return tickets, matrix


def run_kmeans(tickets, matrix):
    print(f"\n[4/6] Running K-Means (k={N_CLUSTERS}) …")
    normalised = normalize(matrix, norm="l2")
    km = KMeans(n_clusters=N_CLUSTERS, init="k-means++", n_init=10, random_state=42)
    labels = km.fit_predict(normalised)
    centroids = km.cluster_centers_

    cluster_map: dict[int, list[dict]] = {i: [] for i in range(N_CLUSTERS)}
    for ticket, label in zip(tickets, labels):
        ticket["_cluster_label"] = int(label)
        cluster_map[int(label)].append(ticket)

    for label, members in cluster_map.items():
        print(f"   Cluster {label}: {len(members)} tickets")

    return cluster_map, centroids


def build_and_store_clusters(cluster_map, centroids, cutoff):
    print(f"\n[5/6] Naming clusters and storing to Supabase …")
    window_mid = cutoff - timedelta(days=WINDOW_DAYS)

    for label, members in cluster_map.items():
        subjects = [m["subject"] for m in members]
        name, description = name_cluster(subjects)
        print(f"   Cluster {label} → \"{name}\"")

        prev_count = sum(
            1 for m in members
            if datetime.fromisoformat(m["created_at"]) < window_mid
        )
        curr_count = sum(
            1 for m in members
            if datetime.fromisoformat(m["created_at"]) >= window_mid
        )
        trend = calculate_trend(prev_count, curr_count)
        print(f"     prev={prev_count}  curr={curr_count}  trend={trend}")

        centroid = centroids[label].tolist()
        cluster_result = supabase.table("issue_clusters").insert({
            "name":               name,
            "description":        description,
            "ticket_count":       len(members),
            "prev_window_count":  prev_count,
            "curr_window_count":  curr_count,
            "trend":              trend,
            "centroid_embedding": centroid,
            "updated_at":         now_utc().isoformat(),
        }).execute()
        cluster_id = cluster_result.data[0]["id"]

        member_rows = [
            {"ticket_id": m["id"], "cluster_id": cluster_id, "similarity_score": 1.0}
            for m in members
        ]
        supabase.table("cluster_members").insert(member_rows).execute()
        time.sleep(0.5)

    print(f"   ✓ {N_CLUSTERS} clusters stored.")


def print_summary():
    print("\n[6/6] Summary")
    result = supabase.rpc("get_clusters_with_tickets").execute()
    arrows = {"Increasing": "⬆", "Decreasing": "⬇", "Stable": "→"}
    for c in result.data:
        arrow = arrows.get(c["trend"], "→")
        print(
            f"  {arrow}  {c['name']}  "
            f"({c['ticket_count']} tickets | "
            f"prev={c['prev_window_count']} curr={c['curr_window_count']} | "
            f"{c['trend']})"
        )
    print()


# ─────────────────────── Entry point ───────────────────────

def main():
    parser = argparse.ArgumentParser(description="Seed Kreo-specific Support Tickets")
    parser.add_argument("--skip-truncate", action="store_true",
                        help="Append without truncating existing data")
    args = parser.parse_args()

    print("=" * 62)
    print("  Kreo Support Ticket Intelligence System — Seeder")
    print("  270 Kreo-branded tickets | 7 categories | OWL SPIKE")
    print("=" * 62)

    raw_tickets = build_raw_tickets()

    if not args.skip_truncate:
        truncate_tables()

    insert_tickets_with_embeddings(raw_tickets)
    tickets, matrix = fetch_tickets_with_embeddings()
    cluster_map, centroids = run_kmeans(tickets, matrix)

    cutoff = now_utc()
    build_and_store_clusters(cluster_map, centroids, cutoff)
    print_summary()

    print("=" * 62)
    print("  Seeding complete! Supabase is ready.")
    print()
    print("  Designed trends:")
    print("   ⬆  Webcam Connectivity Issues  (Owl launch spike)")
    print("   ⬆  Keyboard Connectivity       (Swarm65/Hive75 dropouts)")
    print("   →  Software / Firmware / RGB   (Kreo app issues)")
    print("   →  Shipping & Missing Items    (fulfilment errors)")
    print("   →  Mouse & Controller Issues   (Chimera/Surge)")
    print("   ⬇  Hardware Defects            (quality improving)")
    print("   ⬇  Returns / Warranty          (fewer claims)")
    print()
    print("  Owl Webcam spike: ~28 tickets concentrated in days 10-13")
    print("  Run the Next.js frontend to see the dashboard.")
    print("=" * 62)


if __name__ == "__main__":
    main()
