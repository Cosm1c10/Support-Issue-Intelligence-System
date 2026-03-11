export interface Ticket {
  id: string;
  ticket_id: string;
  subject: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  product_area: string;
  created_at: string;
}

export interface Cluster {
  id: string;
  name: string;
  description: string;
  ticket_count: number;
  prev_window_count: number;
  curr_window_count: number;
  trend: "Increasing" | "Decreasing" | "Stable";
  updated_at: string;
  example_tickets: Ticket[];
}

export type TrendFilter = "all" | "Increasing" | "Decreasing" | "Stable";
export type Space = "support" | "marketplace";
