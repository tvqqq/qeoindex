export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      monitor_runs: {
        Row: {
          buy_count: number
          candidate_count: number
          created_at: string
          error: string | null
          exit_count: number
          finished_at: string | null
          function_version: string
          id: string
          missing_quote_count: number
          open_count: number
          provider: string | null
          quote_count: number
          run_key: string
          scheduled_for: string
          session_state: string
          started_at: string
          status: string
        }
        Insert: {
          buy_count?: number
          candidate_count?: number
          created_at?: string
          error?: string | null
          exit_count?: number
          finished_at?: string | null
          function_version: string
          id?: string
          missing_quote_count?: number
          open_count?: number
          provider?: string | null
          quote_count?: number
          run_key: string
          scheduled_for: string
          session_state: string
          started_at?: string
          status: string
        }
        Update: {
          buy_count?: number
          candidate_count?: number
          created_at?: string
          error?: string | null
          exit_count?: number
          finished_at?: string | null
          function_version?: string
          id?: string
          missing_quote_count?: number
          open_count?: number
          provider?: string | null
          quote_count?: number
          run_key?: string
          scheduled_for?: string
          session_state?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempt_count: number
          channel: string
          created_at: string
          event_id: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: string
          telegram_message_id: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel: string
          created_at?: string
          event_id: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload: Json
          sent_at?: string | null
          status?: string
          telegram_message_id?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          created_at?: string
          event_id?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          telegram_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "signal_events"
            referencedColumns: ["id"]
          },
        ]
      }
      notion_sync_outbox: {
        Row: {
          attempt_count: number
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string
          operation: string
          payload: Json
          status: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string
          operation: string
          payload: Json
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string
          operation?: string
          payload?: Json
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      signal_events: {
        Row: {
          created_at: string
          daily_bias: string | null
          engine_version: string
          event_type: string
          id: string
          idempotency_key: string
          notion_page_id: string | null
          price: number
          provider: string
          recommendation_id: string | null
          rel_volume: number | null
          rule: string
          scan_date: string | null
          signal_at: string
          stop_price: number | null
          ticker: string
          vnindex: number | null
          volume: number | null
        }
        Insert: {
          created_at?: string
          daily_bias?: string | null
          engine_version: string
          event_type: string
          id?: string
          idempotency_key: string
          notion_page_id?: string | null
          price: number
          provider: string
          recommendation_id?: string | null
          rel_volume?: number | null
          rule: string
          scan_date?: string | null
          signal_at: string
          stop_price?: number | null
          ticker: string
          vnindex?: number | null
          volume?: number | null
        }
        Update: {
          created_at?: string
          daily_bias?: string | null
          engine_version?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          notion_page_id?: string | null
          price?: number
          provider?: string
          recommendation_id?: string | null
          rel_volume?: number | null
          rule?: string
          scan_date?: string | null
          signal_at?: string
          stop_price?: number | null
          ticker?: string
          vnindex?: number | null
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_events_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "trade_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_recommendations: {
        Row: {
          alpha_pct: number | null
          buy_price: number
          buy_reason: string
          buy_signal_at: string
          confidence: string
          created_at: string
          daily_bias: string
          engine_version: string
          id: string
          initial_target: number | null
          last_monitor_at: string | null
          last_price: number | null
          last_rel_volume: number | null
          max_adverse_pct: number | null
          max_favorable_pct: number | null
          notion_page_id: string | null
          outcome: string
          provider: string
          return_pct: number | null
          risk_pct: number
          scan_date: string
          sell_price: number | null
          sell_reason: string | null
          sell_signal_at: string | null
          status: string
          stop_price: number
          ticker: string
          updated_at: string
          vnindex_entry: number | null
          vnindex_exit: number | null
          vnindex_return_pct: number | null
        }
        Insert: {
          alpha_pct?: number | null
          buy_price: number
          buy_reason: string
          buy_signal_at: string
          confidence: string
          created_at?: string
          daily_bias: string
          engine_version: string
          id?: string
          initial_target?: number | null
          last_monitor_at?: string | null
          last_price?: number | null
          last_rel_volume?: number | null
          max_adverse_pct?: number | null
          max_favorable_pct?: number | null
          notion_page_id?: string | null
          outcome?: string
          provider: string
          return_pct?: number | null
          risk_pct: number
          scan_date: string
          sell_price?: number | null
          sell_reason?: string | null
          sell_signal_at?: string | null
          status?: string
          stop_price: number
          ticker: string
          updated_at?: string
          vnindex_entry?: number | null
          vnindex_exit?: number | null
          vnindex_return_pct?: number | null
        }
        Update: {
          alpha_pct?: number | null
          buy_price?: number
          buy_reason?: string
          buy_signal_at?: string
          confidence?: string
          created_at?: string
          daily_bias?: string
          engine_version?: string
          id?: string
          initial_target?: number | null
          last_monitor_at?: string | null
          last_price?: number | null
          last_rel_volume?: number | null
          max_adverse_pct?: number | null
          max_favorable_pct?: number | null
          notion_page_id?: string | null
          outcome?: string
          provider?: string
          return_pct?: number | null
          risk_pct?: number
          scan_date?: string
          sell_price?: number | null
          sell_reason?: string | null
          sell_signal_at?: string | null
          status?: string
          stop_price?: number
          ticker?: string
          updated_at?: string
          vnindex_entry?: number | null
          vnindex_exit?: number | null
          vnindex_return_pct?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_notification_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          channel: string
          created_at: string
          event_id: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: string
          telegram_message_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_notion_sync_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string
          operation: string
          payload: Json
          status: string
          synced_at: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notion_sync_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      close_recommendation: {
        Args: {
          p_engine_version: string
          p_event_type: string
          p_idempotency_key: string
          p_max_adverse_pct: number
          p_max_favorable_pct: number
          p_notification_payload?: Json
          p_notion_payload?: Json
          p_provider: string
          p_recommendation_id: string
          p_rel_volume: number
          p_sell_price: number
          p_sell_reason: string
          p_signal_at: string
          p_vnindex_exit: number
          p_volume: number
        }
        Returns: {
          event_id: string
          recommendation_id: string
          result: string
        }[]
      }
      create_buy_signal: {
        Args: {
          p_buy_price: number
          p_buy_reason: string
          p_confidence: string
          p_daily_bias: string
          p_engine_version: string
          p_idempotency_key: string
          p_initial_target: number
          p_notification_payload?: Json
          p_notion_payload?: Json
          p_provider: string
          p_rel_volume: number
          p_risk_pct: number
          p_scan_date: string
          p_signal_at: string
          p_stop_price: number
          p_ticker: string
          p_vnindex_entry: number
          p_volume: number
        }
        Returns: {
          event_id: string
          recommendation_id: string
          result: string
        }[]
      }
      install_stockos_cron: {
        Args: never
        Returns: {
          job_name: string
          schedule: string
        }[]
      }
      uninstall_stockos_cron: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

