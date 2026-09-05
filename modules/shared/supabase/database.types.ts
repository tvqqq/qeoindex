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
      ai_council_agent_stats: {
        Row: {
          agent_key: string
          as_of_date: string
          average_signed_return_5d_pct: number | null
          brier_score: number | null
          calibrated: boolean
          directional_count: number
          hit_rate_pct: number | null
          market_regime: string
          recommended_weight: number
          sample_count: number
          skill_factor: number
          updated_at: string
        }
        Insert: {
          agent_key: string
          as_of_date: string
          average_signed_return_5d_pct?: number | null
          brier_score?: number | null
          calibrated?: boolean
          directional_count?: number
          hit_rate_pct?: number | null
          market_regime?: string
          recommended_weight: number
          sample_count?: number
          skill_factor?: number
          updated_at?: string
        }
        Update: {
          agent_key?: string
          as_of_date?: string
          average_signed_return_5d_pct?: number | null
          brier_score?: number | null
          calibrated?: boolean
          directional_count?: number
          hit_rate_pct?: number | null
          market_regime?: string
          recommended_weight?: number
          sample_count?: number
          skill_factor?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_council_confirmations: {
        Row: {
          created_at: string
          last_refreshed_at: string
          reason: string
          resolved_date: string | null
          sessions_waited: number
          source_as_of_date: string
          source_run_id: string
          status: string
          ticker: string
          trigger_alpha_5d_pct: number | null
          trigger_direction_correct_5d: boolean | null
          trigger_price: number | null
          trigger_return_5d_pct: number | null
          trigger_run_id: string | null
        }
        Insert: {
          created_at?: string
          last_refreshed_at?: string
          reason?: string
          resolved_date?: string | null
          sessions_waited?: number
          source_as_of_date: string
          source_run_id: string
          status?: string
          ticker: string
          trigger_alpha_5d_pct?: number | null
          trigger_direction_correct_5d?: boolean | null
          trigger_price?: number | null
          trigger_return_5d_pct?: number | null
          trigger_run_id?: string | null
        }
        Update: {
          created_at?: string
          last_refreshed_at?: string
          reason?: string
          resolved_date?: string | null
          sessions_waited?: number
          source_as_of_date?: string
          source_run_id?: string
          status?: string
          ticker?: string
          trigger_alpha_5d_pct?: number | null
          trigger_direction_correct_5d?: boolean | null
          trigger_price?: number | null
          trigger_return_5d_pct?: number | null
          trigger_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_confirmations_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: true
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_council_confirmations_trigger_run_id_fkey"
            columns: ["trigger_run_id"]
            isOneToOne: false
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_council_llm_debates: {
        Row: {
          as_of_date: string
          bear_payload: Json | null
          bull_payload: Json | null
          cached_input_tokens: number
          call_audit: Json
          chair_payload: Json | null
          completed_at: string | null
          created_at: string
          deterministic_risk_status: string
          deterministic_score: number
          deterministic_signal: string
          engine: string
          error: string
          escalated: boolean
          escalation_reason: string
          estimated_cost_usd: number | null
          evidence_hash: string
          fallback_used: boolean
          final_authority: string
          input_tokens: number
          latency_ms: number
          llm_advisory_only: boolean
          model: string
          model_route: Json
          output_tokens: number
          pricing_version: string
          prompt_version: string
          reasoning_tokens: number
          risk_payload: Json | null
          run_id: string
          selection_reasons: Json
          status: string
          ticker: string
          total_tokens: number
          updated_at: string
        }
        Insert: {
          as_of_date: string
          bear_payload?: Json | null
          bull_payload?: Json | null
          cached_input_tokens?: number
          call_audit?: Json
          chair_payload?: Json | null
          completed_at?: string | null
          created_at?: string
          deterministic_risk_status: string
          deterministic_score: number
          deterministic_signal: string
          engine: string
          error?: string
          escalated?: boolean
          escalation_reason?: string
          estimated_cost_usd?: number | null
          evidence_hash: string
          fallback_used?: boolean
          final_authority?: string
          input_tokens?: number
          latency_ms?: number
          llm_advisory_only?: boolean
          model: string
          model_route?: Json
          output_tokens?: number
          pricing_version?: string
          prompt_version: string
          reasoning_tokens?: number
          risk_payload?: Json | null
          run_id: string
          selection_reasons?: Json
          status?: string
          ticker: string
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          as_of_date?: string
          bear_payload?: Json | null
          bull_payload?: Json | null
          cached_input_tokens?: number
          call_audit?: Json
          chair_payload?: Json | null
          completed_at?: string | null
          created_at?: string
          deterministic_risk_status?: string
          deterministic_score?: number
          deterministic_signal?: string
          engine?: string
          error?: string
          escalated?: boolean
          escalation_reason?: string
          estimated_cost_usd?: number | null
          evidence_hash?: string
          fallback_used?: boolean
          final_authority?: string
          input_tokens?: number
          latency_ms?: number
          llm_advisory_only?: boolean
          model?: string
          model_route?: Json
          output_tokens?: number
          pricing_version?: string
          prompt_version?: string
          reasoning_tokens?: number
          risk_payload?: Json | null
          run_id?: string
          selection_reasons?: Json
          status?: string
          ticker?: string
          total_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_llm_debates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_council_llm_evidence: {
        Row: {
          captured_at: string
          context_hash: string
          context_payload: Json
          context_version: string
          rating_date: string
          run_id: string
          source_limitations: Json
          ticker: string
        }
        Insert: {
          captured_at?: string
          context_hash: string
          context_payload: Json
          context_version: string
          rating_date: string
          run_id: string
          source_limitations?: Json
          ticker: string
        }
        Update: {
          captured_at?: string
          context_hash?: string
          context_payload?: Json
          context_version?: string
          rating_date?: string
          run_id?: string
          source_limitations?: Json
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_llm_evidence_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_council_llm_research_contexts: {
        Row: {
          as_of_date: string
          captured_at: string
          context_hash: string
          context_payload: Json
          context_version: string
          mode: string
          prompt_identity_hash: string
          raw_context_hash: string
          run_id: string
          source_last_edited: Json
          source_page_ids: Json
          status: string
          ticker: string
        }
        Insert: {
          as_of_date: string
          captured_at?: string
          context_hash: string
          context_payload: Json
          context_version: string
          mode: string
          prompt_identity_hash: string
          raw_context_hash: string
          run_id: string
          source_last_edited?: Json
          source_page_ids?: Json
          status: string
          ticker: string
        }
        Update: {
          as_of_date?: string
          captured_at?: string
          context_hash?: string
          context_payload?: Json
          context_version?: string
          mode?: string
          prompt_identity_hash?: string
          raw_context_hash?: string
          run_id?: string
          source_last_edited?: Json
          source_page_ids?: Json
          status?: string
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_llm_research_contexts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_council_market_benchmarks: {
        Row: {
          close: number
          created_at: string
          fetched_at: string
          high: number
          low: number
          open: number
          provider: string
          provider_detail: string
          regime: string
          return_20d_pct: number | null
          session_date: string
          sma20: number | null
          symbol: string
          updated_at: string
          volume: number | null
        }
        Insert: {
          close: number
          created_at?: string
          fetched_at?: string
          high: number
          low: number
          open: number
          provider?: string
          provider_detail?: string
          regime?: string
          return_20d_pct?: number | null
          session_date: string
          sma20?: number | null
          symbol?: string
          updated_at?: string
          volume?: number | null
        }
        Update: {
          close?: number
          created_at?: string
          fetched_at?: string
          high?: number
          low?: number
          open?: number
          provider?: string
          provider_detail?: string
          regime?: string
          return_20d_pct?: number | null
          session_date?: string
          sma20?: number | null
          symbol?: string
          updated_at?: string
          volume?: number | null
        }
        Relationships: []
      }
      ai_council_outcomes: {
        Row: {
          alpha_1d_pct: number | null
          alpha_20d_pct: number | null
          alpha_5d_pct: number | null
          as_of_date: string
          benchmark: string
          direction_correct_5d: boolean | null
          evaluated_through_date: string | null
          last_refreshed_at: string
          mae_20d_pct: number | null
          mfe_20d_pct: number | null
          notes: string
          outcome_status: string
          return_1d_pct: number | null
          return_20d_pct: number | null
          return_5d_pct: number | null
          run_id: string
          sessions_observed: number
          start_price: number | null
          ticker: string
        }
        Insert: {
          alpha_1d_pct?: number | null
          alpha_20d_pct?: number | null
          alpha_5d_pct?: number | null
          as_of_date: string
          benchmark?: string
          direction_correct_5d?: boolean | null
          evaluated_through_date?: string | null
          last_refreshed_at?: string
          mae_20d_pct?: number | null
          mfe_20d_pct?: number | null
          notes?: string
          outcome_status?: string
          return_1d_pct?: number | null
          return_20d_pct?: number | null
          return_5d_pct?: number | null
          run_id: string
          sessions_observed?: number
          start_price?: number | null
          ticker: string
        }
        Update: {
          alpha_1d_pct?: number | null
          alpha_20d_pct?: number | null
          alpha_5d_pct?: number | null
          as_of_date?: string
          benchmark?: string
          direction_correct_5d?: boolean | null
          evaluated_through_date?: string | null
          last_refreshed_at?: string
          mae_20d_pct?: number | null
          mfe_20d_pct?: number | null
          notes?: string
          outcome_status?: string
          return_1d_pct?: number | null
          return_20d_pct?: number | null
          return_5d_pct?: number | null
          run_id?: string
          sessions_observed?: number
          start_price?: number | null
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_outcomes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_council_report_evidence_snapshots: {
        Row: {
          analysis_ids: Json
          as_of_date: string
          captured_at: string
          context_hash: string
          context_payload: Json
          context_version: string
          report_ids: Json
          run_id: string
          status: string
          ticker: string
        }
        Insert: {
          analysis_ids?: Json
          as_of_date: string
          captured_at?: string
          context_hash: string
          context_payload: Json
          context_version: string
          report_ids?: Json
          run_id: string
          status: string
          ticker: string
        }
        Update: {
          analysis_ids?: Json
          as_of_date?: string
          captured_at?: string
          context_hash?: string
          context_payload?: Json
          context_version?: string
          report_ids?: Json
          run_id?: string
          status?: string
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_report_evidence_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_council_runs: {
        Row: {
          as_of_date: string
          bar_closed_at: string | null
          bear_case: Json
          bear_votes: number
          bull_case: Json
          bull_votes: number
          calibration_version: string
          confidence: number
          confirmation: string
          confirmation_pending: boolean
          consensus: number
          council_score: number
          created_at: string
          data_quality: string
          decision_payload: Json
          dissent: string
          evidence_hash: string
          evidence_version: string
          id: string
          invalidation: string
          market_regime: string
          neutral_votes: number
          policy_version: string
          price: number | null
          rating_date: string
          resistance: string
          risk_status: string
          signal: string
          support: string
          ticker: string
          weight_profile: Json
          what_changes_decision: Json
        }
        Insert: {
          as_of_date: string
          bar_closed_at?: string | null
          bear_case?: Json
          bear_votes?: number
          bull_case?: Json
          bull_votes?: number
          calibration_version?: string
          confidence: number
          confirmation?: string
          confirmation_pending?: boolean
          consensus: number
          council_score: number
          created_at?: string
          data_quality: string
          decision_payload?: Json
          dissent?: string
          evidence_hash: string
          evidence_version: string
          id?: string
          invalidation?: string
          market_regime?: string
          neutral_votes?: number
          policy_version: string
          price?: number | null
          rating_date: string
          resistance?: string
          risk_status: string
          signal: string
          support?: string
          ticker: string
          weight_profile?: Json
          what_changes_decision?: Json
        }
        Update: {
          as_of_date?: string
          bar_closed_at?: string | null
          bear_case?: Json
          bear_votes?: number
          bull_case?: Json
          bull_votes?: number
          calibration_version?: string
          confidence?: number
          confirmation?: string
          confirmation_pending?: boolean
          consensus?: number
          council_score?: number
          created_at?: string
          data_quality?: string
          decision_payload?: Json
          dissent?: string
          evidence_hash?: string
          evidence_version?: string
          id?: string
          invalidation?: string
          market_regime?: string
          neutral_votes?: number
          policy_version?: string
          price?: number | null
          rating_date?: string
          resistance?: string
          risk_status?: string
          signal?: string
          support?: string
          ticker?: string
          weight_profile?: Json
          what_changes_decision?: Json
        }
        Relationships: []
      }
      ai_council_votes: {
        Row: {
          agent_key: string
          agent_label: string
          confidence: number
          created_at: string
          engine: string
          evidence_against: Json
          evidence_for: Json
          policy_version: string
          role: string
          run_id: string
          score: number
          stance: string
          summary: string
        }
        Insert: {
          agent_key: string
          agent_label: string
          confidence: number
          created_at?: string
          engine?: string
          evidence_against?: Json
          evidence_for?: Json
          policy_version: string
          role: string
          run_id: string
          score: number
          stance: string
          summary?: string
        }
        Update: {
          agent_key?: string
          agent_label?: string
          confidence?: number
          created_at?: string
          engine?: string
          evidence_against?: Json
          evidence_for?: Json
          policy_version?: string
          role?: string
          run_id?: string
          score?: number
          stance?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_council_votes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_council_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_ohlcv_cold_manifests: {
        Row: {
          archive_format: string
          base_resolution: string
          byte_count: number | null
          created_at: string
          format_version: number
          id: string
          object_path: string
          provenance_batch_id: string | null
          range_end: string
          range_start: string
          row_count: number
          sha256: string
          ticker: string
          verified_at: string
        }
        Insert: {
          archive_format: string
          base_resolution: string
          byte_count?: number | null
          created_at?: string
          format_version?: number
          id?: string
          object_path: string
          provenance_batch_id?: string | null
          range_end: string
          range_start: string
          row_count: number
          sha256: string
          ticker: string
          verified_at?: string
        }
        Update: {
          archive_format?: string
          base_resolution?: string
          byte_count?: number | null
          created_at?: string
          format_version?: number
          id?: string
          object_path?: string
          provenance_batch_id?: string | null
          range_end?: string
          range_start?: string
          row_count?: number
          sha256?: string
          ticker?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_ohlcv_cold_manifests_provenance_batch_id_fkey"
            columns: ["provenance_batch_id"]
            isOneToOne: false
            referencedRelation: "chart_ohlcv_provenance_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_ohlcv_derived_hourly: {
        Row: {
          aggregation_version: string
          bar_time: string
          close: number
          generated_at: string
          high: number
          low: number
          open: number
          resolution: string
          source_manifest_id: string
          source_range_end: string
          source_range_start: string
          source_raw_row_count: number
          source_sha256: string
          ticker: string
          volume: number
        }
        Insert: {
          aggregation_version?: string
          bar_time: string
          close: number
          generated_at?: string
          high: number
          low: number
          open: number
          resolution?: string
          source_manifest_id: string
          source_range_end: string
          source_range_start: string
          source_raw_row_count: number
          source_sha256: string
          ticker: string
          volume: number
        }
        Update: {
          aggregation_version?: string
          bar_time?: string
          close?: number
          generated_at?: string
          high?: number
          low?: number
          open?: number
          resolution?: string
          source_manifest_id?: string
          source_range_end?: string
          source_range_start?: string
          source_raw_row_count?: number
          source_sha256?: string
          ticker?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "chart_ohlcv_derived_hourly_source_manifest_id_fkey"
            columns: ["source_manifest_id"]
            isOneToOne: false
            referencedRelation: "chart_ohlcv_cold_manifests"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_ohlcv_intraday: {
        Row: {
          bar_time: string
          base_resolution: string
          close: number
          fetched_at: string
          high: number
          low: number
          open: number
          provenance_batch_id: string | null
          ticker: string
          volume: number
        }
        Insert: {
          bar_time: string
          base_resolution: string
          close: number
          fetched_at?: string
          high: number
          low: number
          open: number
          provenance_batch_id?: string | null
          ticker: string
          volume: number
        }
        Update: {
          bar_time?: string
          base_resolution?: string
          close?: number
          fetched_at?: string
          high?: number
          low?: number
          open?: number
          provenance_batch_id?: string | null
          ticker?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "chart_ohlcv_intraday_provenance_batch_id_fkey"
            columns: ["provenance_batch_id"]
            isOneToOne: false
            referencedRelation: "chart_ohlcv_provenance_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_ohlcv_provenance_batches: {
        Row: {
          base_resolution: string
          detail: Json
          fetched_at: string
          id: string
          provider: string
          range_end: string
          range_start: string
          row_count: number
          ticker: string
        }
        Insert: {
          base_resolution: string
          detail?: Json
          fetched_at?: string
          id?: string
          provider: string
          range_end: string
          range_start: string
          row_count: number
          ticker: string
        }
        Update: {
          base_resolution?: string
          detail?: Json
          fetched_at?: string
          id?: string
          provider?: string
          range_end?: string
          range_start?: string
          row_count?: number
          ticker?: string
        }
        Relationships: []
      }
      insights_stock_ratings: {
        Row: {
          as_of_date: string
          average_volume_50_sessions: number | null
          beta: number | null
          company_name: string | null
          created_at: string
          exchange: string | null
          fetched_at: string
          id: number
          is_published: boolean
          kfsp_canslim_score: number | null
          kfsp_composite_score: number | null
          kfsp_contract_version: number
          kfsp_metrics: Json
          kfsp_price_potential: string | null
          kfsp_score_4m: number | null
          kfsp_sector_rrg_state: string | null
          kfsp_sector_rs_score: number | null
          kfsp_stock_rrg_state: string | null
          kfsp_stock_rs_score: number | null
          market_cap_billion: number | null
          monthly_change_pct: number | null
          pb_ttm: number | null
          pe_ttm: number | null
          price: number | null
          price_change_pct: number | null
          rs_medium: number | null
          rs_short: number | null
          rsi_14: number | null
          sector: string | null
          source: string
          source_url: string | null
          sync_run_id: string | null
          ticker: string
          updated_at: string
          weekly_change_pct: number | null
        }
        Insert: {
          as_of_date: string
          average_volume_50_sessions?: number | null
          beta?: number | null
          company_name?: string | null
          created_at?: string
          exchange?: string | null
          fetched_at?: string
          id?: number
          is_published?: boolean
          kfsp_canslim_score?: number | null
          kfsp_composite_score?: number | null
          kfsp_contract_version?: number
          kfsp_metrics?: Json
          kfsp_price_potential?: string | null
          kfsp_score_4m?: number | null
          kfsp_sector_rrg_state?: string | null
          kfsp_sector_rs_score?: number | null
          kfsp_stock_rrg_state?: string | null
          kfsp_stock_rs_score?: number | null
          market_cap_billion?: number | null
          monthly_change_pct?: number | null
          pb_ttm?: number | null
          pe_ttm?: number | null
          price?: number | null
          price_change_pct?: number | null
          rs_medium?: number | null
          rs_short?: number | null
          rsi_14?: number | null
          sector?: string | null
          source?: string
          source_url?: string | null
          sync_run_id?: string | null
          ticker: string
          updated_at?: string
          weekly_change_pct?: number | null
        }
        Update: {
          as_of_date?: string
          average_volume_50_sessions?: number | null
          beta?: number | null
          company_name?: string | null
          created_at?: string
          exchange?: string | null
          fetched_at?: string
          id?: number
          is_published?: boolean
          kfsp_canslim_score?: number | null
          kfsp_composite_score?: number | null
          kfsp_contract_version?: number
          kfsp_metrics?: Json
          kfsp_price_potential?: string | null
          kfsp_score_4m?: number | null
          kfsp_sector_rrg_state?: string | null
          kfsp_sector_rs_score?: number | null
          kfsp_stock_rrg_state?: string | null
          kfsp_stock_rs_score?: number | null
          market_cap_billion?: number | null
          monthly_change_pct?: number | null
          pb_ttm?: number | null
          pe_ttm?: number | null
          price?: number | null
          price_change_pct?: number | null
          rs_medium?: number | null
          rs_short?: number | null
          rsi_14?: number | null
          sector?: string | null
          source?: string
          source_url?: string | null
          sync_run_id?: string | null
          ticker?: string
          updated_at?: string
          weekly_change_pct?: number | null
        }
        Relationships: []
      }
      kfsp_manual_dispatch_runs: {
        Row: {
          completed_at: string | null
          dispatched_at: string
          error_code: string | null
          error_message: string | null
          final_summary: Json | null
          job_key: string
          net_request_id: number | null
          reason: string
          request_body: Json
          request_id: string
          requested_by: string
          started_at: string | null
          status: string | null
          sync_run_id: string | null
          system_job_run_id: string | null
        }
        Insert: {
          completed_at?: string | null
          dispatched_at?: string
          error_code?: string | null
          error_message?: string | null
          final_summary?: Json | null
          job_key: string
          net_request_id?: number | null
          reason: string
          request_body: Json
          request_id: string
          requested_by: string
          started_at?: string | null
          status?: string | null
          sync_run_id?: string | null
          system_job_run_id?: string | null
        }
        Update: {
          completed_at?: string | null
          dispatched_at?: string
          error_code?: string | null
          error_message?: string | null
          final_summary?: Json | null
          job_key?: string
          net_request_id?: number | null
          reason?: string
          request_body?: Json
          request_id?: string
          requested_by?: string
          started_at?: string | null
          status?: string | null
          sync_run_id?: string | null
          system_job_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kfsp_manual_dispatch_runs_system_job_run_id_fkey"
            columns: ["system_job_run_id"]
            isOneToOne: false
            referencedRelation: "system_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      kfsp_rating_raw_evidence: {
        Row: {
          as_of_date: string
          created_at: string
          expires_at: string
          fetched_at: string
          raw_payload: Json
          sync_run_id: string
          ticker: string
        }
        Insert: {
          as_of_date: string
          created_at?: string
          expires_at: string
          fetched_at: string
          raw_payload: Json
          sync_run_id: string
          ticker: string
        }
        Update: {
          as_of_date?: string
          created_at?: string
          expires_at?: string
          fetched_at?: string
          raw_payload?: Json
          sync_run_id?: string
          ticker?: string
        }
        Relationships: []
      }
      kfsp_rating_staging: {
        Row: {
          as_of_date: string
          average_volume_50_sessions: number | null
          beta: number | null
          company_name: string | null
          exchange: string | null
          fetched_at: string
          industry_group: string | null
          kfsp_canslim_score: number | null
          kfsp_composite_score: number | null
          kfsp_metrics: Json
          kfsp_price_potential: string | null
          kfsp_score_4m: number | null
          kfsp_sector_rrg_state: string | null
          kfsp_sector_rs_score: number | null
          kfsp_stock_rrg_state: string | null
          kfsp_stock_rs_score: number | null
          market_cap_billion: number | null
          monthly_change_pct: number | null
          pb_ttm: number | null
          pe_ttm: number | null
          price: number | null
          price_change_pct: number | null
          raw_payload: Json
          rs_medium: number | null
          rs_short: number | null
          rsi_14: number | null
          sector: string | null
          sync_run_id: string
          ticker: string
          weekly_change_pct: number | null
        }
        Insert: {
          as_of_date: string
          average_volume_50_sessions?: number | null
          beta?: number | null
          company_name?: string | null
          exchange?: string | null
          fetched_at: string
          industry_group?: string | null
          kfsp_canslim_score?: number | null
          kfsp_composite_score?: number | null
          kfsp_metrics: Json
          kfsp_price_potential?: string | null
          kfsp_score_4m?: number | null
          kfsp_sector_rrg_state?: string | null
          kfsp_sector_rs_score?: number | null
          kfsp_stock_rrg_state?: string | null
          kfsp_stock_rs_score?: number | null
          market_cap_billion?: number | null
          monthly_change_pct?: number | null
          pb_ttm?: number | null
          pe_ttm?: number | null
          price?: number | null
          price_change_pct?: number | null
          raw_payload: Json
          rs_medium?: number | null
          rs_short?: number | null
          rsi_14?: number | null
          sector?: string | null
          sync_run_id: string
          ticker: string
          weekly_change_pct?: number | null
        }
        Update: {
          as_of_date?: string
          average_volume_50_sessions?: number | null
          beta?: number | null
          company_name?: string | null
          exchange?: string | null
          fetched_at?: string
          industry_group?: string | null
          kfsp_canslim_score?: number | null
          kfsp_composite_score?: number | null
          kfsp_metrics?: Json
          kfsp_price_potential?: string | null
          kfsp_score_4m?: number | null
          kfsp_sector_rrg_state?: string | null
          kfsp_sector_rs_score?: number | null
          kfsp_stock_rrg_state?: string | null
          kfsp_stock_rs_score?: number | null
          market_cap_billion?: number | null
          monthly_change_pct?: number | null
          pb_ttm?: number | null
          pe_ttm?: number | null
          price?: number | null
          price_change_pct?: number | null
          raw_payload?: Json
          rs_medium?: number | null
          rs_short?: number | null
          rsi_14?: number | null
          sector?: string | null
          sync_run_id?: string
          ticker?: string
          weekly_change_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kfsp_rating_staging_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "kfsp_rating_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      kfsp_rating_sync_runs: {
        Row: {
          as_of_date: string
          completed_at: string | null
          contract_version: number
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          provider: string
          provider_row_count: number
          published_row_count: number
          staged_row_count: number
          started_at: string
          status: string
          token_refreshed: boolean
        }
        Insert: {
          as_of_date: string
          completed_at?: string | null
          contract_version?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id: string
          provider?: string
          provider_row_count?: number
          published_row_count?: number
          staged_row_count?: number
          started_at?: string
          status: string
          token_refreshed?: boolean
        }
        Update: {
          as_of_date?: string
          completed_at?: string | null
          contract_version?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          provider?: string
          provider_row_count?: number
          published_row_count?: number
          staged_row_count?: number
          started_at?: string
          status?: string
          token_refreshed?: boolean
        }
        Relationships: []
      }
      kfsp_ttai_quarterly_history: {
        Row: {
          canslim_components: Json
          canslim_score: number | null
          created_at: string
          fetched_at: string
          fourm_components: Json
          fourm_score: number | null
          period: string
          period_quarter: number
          period_year: number
          source: string
          ticker: string
          updated_at: string
        }
        Insert: {
          canslim_components?: Json
          canslim_score?: number | null
          created_at?: string
          fetched_at?: string
          fourm_components?: Json
          fourm_score?: number | null
          period: string
          period_quarter: number
          period_year: number
          source?: string
          ticker: string
          updated_at?: string
        }
        Update: {
          canslim_components?: Json
          canslim_score?: number | null
          created_at?: string
          fetched_at?: string
          fourm_components?: Json
          fourm_score?: number | null
          period?: string
          period_quarter?: number
          period_year?: number
          source?: string
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      kfsp_ttai_sync_runs: {
        Row: {
          candidate_count: number
          completed_at: string | null
          error_message: string | null
          failed_count: number
          id: string
          latest_rating_date: string | null
          processed_count: number
          started_at: string
          status: string
        }
        Insert: {
          candidate_count?: number
          completed_at?: string | null
          error_message?: string | null
          failed_count?: number
          id: string
          latest_rating_date?: string | null
          processed_count?: number
          started_at?: string
          status: string
        }
        Update: {
          candidate_count?: number
          completed_at?: string | null
          error_message?: string | null
          failed_count?: number
          id?: string
          latest_rating_date?: string | null
          processed_count?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      kfsp_ttai_sync_state: {
        Row: {
          financial_period: string | null
          last_error: string | null
          last_success_at: string | null
          latest_provider_period: string | null
          ticker: string
          updated_at: string
        }
        Insert: {
          financial_period?: string | null
          last_error?: string | null
          last_success_at?: string | null
          latest_provider_period?: string | null
          ticker: string
          updated_at?: string
        }
        Update: {
          financial_period?: string | null
          last_error?: string | null
          last_success_at?: string | null
          latest_provider_period?: string | null
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      kfsp_universe_candidate_snapshots: {
        Row: {
          as_of_date: string
          average_volume_50_sessions: number | null
          company_name: string | null
          exchange: string | null
          fetched_at: string
          market_cap_billion: number | null
          sector: string | null
          sync_run_id: string
          ticker: string
          volume_1d: number | null
        }
        Insert: {
          as_of_date: string
          average_volume_50_sessions?: number | null
          company_name?: string | null
          exchange?: string | null
          fetched_at?: string
          market_cap_billion?: number | null
          sector?: string | null
          sync_run_id: string
          ticker: string
          volume_1d?: number | null
        }
        Update: {
          as_of_date?: string
          average_volume_50_sessions?: number | null
          company_name?: string | null
          exchange?: string | null
          fetched_at?: string
          market_cap_billion?: number | null
          sector?: string | null
          sync_run_id?: string
          ticker?: string
          volume_1d?: number | null
        }
        Relationships: []
      }
      market_ai_conclusions: {
        Row: {
          as_of: string
          attempt_count: number
          claim_token: string | null
          claimed_at: string | null
          completed_at: string | null
          conclusion_payload: Json
          created_at: string
          error_code: string | null
          estimated_cost_usd: number | null
          evidence_hash: string
          evidence_manifest: Json
          id: string
          input_tokens: number | null
          lease_expires_at: string | null
          model: string | null
          model_started_at: string | null
          output_tokens: number | null
          policy_version: string
          posture: string
          prompt_version: string
          schema_version: string
          session_date: string
          snapshot_id: string
          status: string
          updated_at: string
        }
        Insert: {
          as_of: string
          attempt_count?: number
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          conclusion_payload?: Json
          created_at?: string
          error_code?: string | null
          estimated_cost_usd?: number | null
          evidence_hash: string
          evidence_manifest?: Json
          id?: string
          input_tokens?: number | null
          lease_expires_at?: string | null
          model?: string | null
          model_started_at?: string | null
          output_tokens?: number | null
          policy_version: string
          posture: string
          prompt_version: string
          schema_version: string
          session_date: string
          snapshot_id: string
          status: string
          updated_at?: string
        }
        Update: {
          as_of?: string
          attempt_count?: number
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          conclusion_payload?: Json
          created_at?: string
          error_code?: string | null
          estimated_cost_usd?: number | null
          evidence_hash?: string
          evidence_manifest?: Json
          id?: string
          input_tokens?: number | null
          lease_expires_at?: string | null
          model?: string | null
          model_started_at?: string | null
          output_tokens?: number | null
          policy_version?: string
          posture?: string
          prompt_version?: string
          schema_version?: string
          session_date?: string
          snapshot_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_insight_daily: {
        Row: {
          above_ma10_pct: number | null
          above_ma20_pct: number | null
          above_ma200_pct: number | null
          above_ma50_pct: number | null
          as_of: string
          contract_version: number
          created_at: string
          distribution_count: number | null
          distribution_window: string | null
          evidence_refs: Json
          foreign_net_value: number | null
          market_regime: string | null
          missing_fields: Json
          other_flow_net_value: number | null
          proprietary_net_value: number | null
          published_at: string
          quality_status: string
          risk_history: Json
          risk_label: string | null
          risk_score: number | null
          sentiment_history: Json
          sentiment_label: string | null
          sentiment_score: number | null
          session_date: string
          source_timestamp: string | null
          sync_run_id: string | null
          total_matched_volume: number | null
          total_traded_value: number | null
          valuation_history: Json
        }
        Insert: {
          above_ma10_pct?: number | null
          above_ma20_pct?: number | null
          above_ma200_pct?: number | null
          above_ma50_pct?: number | null
          as_of?: string
          contract_version?: number
          created_at?: string
          distribution_count?: number | null
          distribution_window?: string | null
          evidence_refs?: Json
          foreign_net_value?: number | null
          market_regime?: string | null
          missing_fields?: Json
          other_flow_net_value?: number | null
          proprietary_net_value?: number | null
          published_at?: string
          quality_status?: string
          risk_history?: Json
          risk_label?: string | null
          risk_score?: number | null
          sentiment_history?: Json
          sentiment_label?: string | null
          sentiment_score?: number | null
          session_date: string
          source_timestamp?: string | null
          sync_run_id?: string | null
          total_matched_volume?: number | null
          total_traded_value?: number | null
          valuation_history?: Json
        }
        Update: {
          above_ma10_pct?: number | null
          above_ma20_pct?: number | null
          above_ma200_pct?: number | null
          above_ma50_pct?: number | null
          as_of?: string
          contract_version?: number
          created_at?: string
          distribution_count?: number | null
          distribution_window?: string | null
          evidence_refs?: Json
          foreign_net_value?: number | null
          market_regime?: string | null
          missing_fields?: Json
          other_flow_net_value?: number | null
          proprietary_net_value?: number | null
          published_at?: string
          quality_status?: string
          risk_history?: Json
          risk_label?: string | null
          risk_score?: number | null
          sentiment_history?: Json
          sentiment_label?: string | null
          sentiment_score?: number | null
          session_date?: string
          source_timestamp?: string | null
          sync_run_id?: string | null
          total_matched_volume?: number | null
          total_traded_value?: number | null
          valuation_history?: Json
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_daily_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "market_insight_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_indexes: {
        Row: {
          advances: number
          as_of: string
          ceilings: number
          change: number
          change_pct: number
          created_at: string
          declines: number
          evidence_refs: Json
          floors: number
          foreign_buy_value: number | null
          foreign_net_value: number | null
          foreign_sell_value: number | null
          high: number | null
          index_code: string
          low: number | null
          market_pe: number | null
          matched_volume: number | null
          missing_fields: Json
          open: number | null
          previous_value_change_pct: number | null
          quality_status: string
          reference: number | null
          session_date: string
          source_timestamp: string | null
          sync_run_id: string | null
          traded_value: number | null
          unchanged: number
          value: number
        }
        Insert: {
          advances?: number
          as_of?: string
          ceilings?: number
          change: number
          change_pct: number
          created_at?: string
          declines?: number
          evidence_refs?: Json
          floors?: number
          foreign_buy_value?: number | null
          foreign_net_value?: number | null
          foreign_sell_value?: number | null
          high?: number | null
          index_code: string
          low?: number | null
          market_pe?: number | null
          matched_volume?: number | null
          missing_fields?: Json
          open?: number | null
          previous_value_change_pct?: number | null
          quality_status?: string
          reference?: number | null
          session_date: string
          source_timestamp?: string | null
          sync_run_id?: string | null
          traded_value?: number | null
          unchanged?: number
          value: number
        }
        Update: {
          advances?: number
          as_of?: string
          ceilings?: number
          change?: number
          change_pct?: number
          created_at?: string
          declines?: number
          evidence_refs?: Json
          floors?: number
          foreign_buy_value?: number | null
          foreign_net_value?: number | null
          foreign_sell_value?: number | null
          high?: number | null
          index_code?: string
          low?: number | null
          market_pe?: number | null
          matched_volume?: number | null
          missing_fields?: Json
          open?: number | null
          previous_value_change_pct?: number | null
          quality_status?: string
          reference?: number | null
          session_date?: string
          source_timestamp?: string | null
          sync_run_id?: string | null
          traded_value?: number | null
          unchanged?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_indexes_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "market_insight_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_leaders: {
        Row: {
          as_of: string
          category: string
          change_pct: number | null
          created_at: string
          estimated_index_points: number | null
          evidence_refs: Json
          metric_label: string | null
          metric_value: number | null
          missing_fields: Json
          price: number | null
          quality_status: string
          rank: number
          session_date: string
          source_timestamp: string | null
          sync_run_id: string | null
          ticker: string
        }
        Insert: {
          as_of?: string
          category: string
          change_pct?: number | null
          created_at?: string
          estimated_index_points?: number | null
          evidence_refs?: Json
          metric_label?: string | null
          metric_value?: number | null
          missing_fields?: Json
          price?: number | null
          quality_status?: string
          rank: number
          session_date: string
          source_timestamp?: string | null
          sync_run_id?: string | null
          ticker: string
        }
        Update: {
          as_of?: string
          category?: string
          change_pct?: number | null
          created_at?: string
          estimated_index_points?: number | null
          evidence_refs?: Json
          metric_label?: string | null
          metric_value?: number | null
          missing_fields?: Json
          price?: number | null
          quality_status?: string
          rank?: number
          session_date?: string
          source_timestamp?: string | null
          sync_run_id?: string | null
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_leaders_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "market_insight_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_sectors: {
        Row: {
          advances: number
          as_of: string
          average_change_pct: number | null
          close_price: number | null
          created_at: string
          declines: number
          display_name: string
          effort_pct: number | null
          effort_result_state: string | null
          evidence_refs: Json
          ma10_state: string | null
          ma20_state: string | null
          ma50_state: string | null
          missing_fields: Json
          momentum_ratio: number | null
          previous_traded_value: number | null
          quality_status: string
          result_pct: number | null
          rotation_history: Json
          rotation_state: string
          rs_score: number | null
          sector_key: string
          session_date: string
          source_timestamp: string | null
          strength_ratio: number | null
          sync_run_id: string | null
          time_window: string
          traded_value: number | null
          unchanged: number
        }
        Insert: {
          advances?: number
          as_of?: string
          average_change_pct?: number | null
          close_price?: number | null
          created_at?: string
          declines?: number
          display_name: string
          effort_pct?: number | null
          effort_result_state?: string | null
          evidence_refs?: Json
          ma10_state?: string | null
          ma20_state?: string | null
          ma50_state?: string | null
          missing_fields?: Json
          momentum_ratio?: number | null
          previous_traded_value?: number | null
          quality_status?: string
          result_pct?: number | null
          rotation_history?: Json
          rotation_state?: string
          rs_score?: number | null
          sector_key: string
          session_date: string
          source_timestamp?: string | null
          strength_ratio?: number | null
          sync_run_id?: string | null
          time_window?: string
          traded_value?: number | null
          unchanged?: number
        }
        Update: {
          advances?: number
          as_of?: string
          average_change_pct?: number | null
          close_price?: number | null
          created_at?: string
          declines?: number
          display_name?: string
          effort_pct?: number | null
          effort_result_state?: string | null
          evidence_refs?: Json
          ma10_state?: string | null
          ma20_state?: string | null
          ma50_state?: string | null
          missing_fields?: Json
          momentum_ratio?: number | null
          previous_traded_value?: number | null
          quality_status?: string
          result_pct?: number | null
          rotation_history?: Json
          rotation_state?: string
          rs_score?: number | null
          sector_key?: string
          session_date?: string
          source_timestamp?: string | null
          strength_ratio?: number | null
          sync_run_id?: string | null
          time_window?: string
          traded_value?: number | null
          unchanged?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_sectors_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "market_insight_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_snapshot_staging: {
        Row: {
          category: string
          created_at: string
          normalized_payload: Json
          observed_at: string
          run_id: string
          staging_key: string
        }
        Insert: {
          category: string
          created_at?: string
          normalized_payload: Json
          observed_at?: string
          run_id: string
          staging_key: string
        }
        Update: {
          category?: string
          created_at?: string
          normalized_payload?: Json
          observed_at?: string
          run_id?: string
          staging_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_insight_snapshot_staging_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "market_insight_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_insight_sync_runs: {
        Row: {
          completed_at: string | null
          contract_version: number
          created_at: string
          endpoint_coverage: Json
          id: string
          payload_checksum: string | null
          published_counts: Json
          quality_status: string
          sanitized_error_code: string | null
          sanitized_error_message: string | null
          session_date: string
          source_observed_at: string | null
          staged_counts: Json
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          completed_at?: string | null
          contract_version?: number
          created_at?: string
          endpoint_coverage?: Json
          id?: string
          payload_checksum?: string | null
          published_counts?: Json
          quality_status?: string
          sanitized_error_code?: string | null
          sanitized_error_message?: string | null
          session_date: string
          source_observed_at?: string | null
          staged_counts?: Json
          started_at?: string
          status: string
          trigger?: string
        }
        Update: {
          completed_at?: string | null
          contract_version?: number
          created_at?: string
          endpoint_coverage?: Json
          id?: string
          payload_checksum?: string | null
          published_counts?: Json
          quality_status?: string
          sanitized_error_code?: string | null
          sanitized_error_message?: string | null
          session_date?: string
          source_observed_at?: string | null
          staged_counts?: Json
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      market_logo_provenance: {
        Row: {
          created_at: string
          logo_kind: string
          logo_path: string
          source: string
          ticker: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          logo_kind: string
          logo_path: string
          source: string
          ticker: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          logo_kind?: string
          logo_path?: string
          source?: string
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_ohlcv_bootstrap_state: {
        Row: {
          completed: boolean
          completed_at: string | null
          first_bar_time: string | null
          last_bar_time: string | null
          provider: string
          ticker: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          first_bar_time?: string | null
          last_bar_time?: string | null
          provider?: string
          ticker: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          first_bar_time?: string | null
          last_bar_time?: string | null
          provider?: string
          ticker?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_ohlcv_history: {
        Row: {
          bar_time: string
          close: number
          fetched_at: string
          high: number
          low: number
          open: number
          provider: string
          provider_detail: string
          source_url: string
          ticker: string
          timeframe: string
          volume: number
        }
        Insert: {
          bar_time: string
          close: number
          fetched_at: string
          high: number
          low: number
          open: number
          provider: string
          provider_detail: string
          source_url: string
          ticker: string
          timeframe: string
          volume: number
        }
        Update: {
          bar_time?: string
          close?: number
          fetched_at?: string
          high?: number
          low?: number
          open?: number
          provider?: string
          provider_detail?: string
          source_url?: string
          ticker?: string
          timeframe?: string
          volume?: number
        }
        Relationships: []
      }
      market_research_report_analyses: {
        Row: {
          analysis_version: string
          cache_write_tokens: number
          cached_input_tokens: number
          catalysts: Json
          chunk_version: string
          confidence: Json
          content_hash: string
          created_at: string
          estimated_cost_usd: number | null
          executive_summary: string
          id: string
          input_tokens: number
          key_points: Json
          latency_ms: number
          market_view: string | null
          model_actual: string | null
          model_requested: string
          model_route_key: string
          output_tokens: number
          pricing_version: string | null
          processed_at: string
          prompt_version: string
          reasoning_effort: string
          reasoning_tokens: number
          report_id: string
          response_id: string | null
          risks: Json
          sector_outlook: string | null
          total_tokens: number
        }
        Insert: {
          analysis_version: string
          cache_write_tokens?: number
          cached_input_tokens?: number
          catalysts?: Json
          chunk_version: string
          confidence?: Json
          content_hash: string
          created_at?: string
          estimated_cost_usd?: number | null
          executive_summary: string
          id?: string
          input_tokens?: number
          key_points?: Json
          latency_ms?: number
          market_view?: string | null
          model_actual?: string | null
          model_requested: string
          model_route_key: string
          output_tokens?: number
          pricing_version?: string | null
          processed_at?: string
          prompt_version: string
          reasoning_effort: string
          reasoning_tokens?: number
          report_id: string
          response_id?: string | null
          risks?: Json
          sector_outlook?: string | null
          total_tokens?: number
        }
        Update: {
          analysis_version?: string
          cache_write_tokens?: number
          cached_input_tokens?: number
          catalysts?: Json
          chunk_version?: string
          confidence?: Json
          content_hash?: string
          created_at?: string
          estimated_cost_usd?: number | null
          executive_summary?: string
          id?: string
          input_tokens?: number
          key_points?: Json
          latency_ms?: number
          market_view?: string | null
          model_actual?: string | null
          model_requested?: string
          model_route_key?: string
          output_tokens?: number
          pricing_version?: string | null
          processed_at?: string
          prompt_version?: string
          reasoning_effort?: string
          reasoning_tokens?: number
          report_id?: string
          response_id?: string | null
          risks?: Json
          sector_outlook?: string | null
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_research_report_analyses_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "market_research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_report_analysis_leases: {
        Row: {
          analysis_version: string
          content_hash: string
          created_at: string
          expires_at: string
          id: string
          lease_token: string
          model_route_key: string
          owner_run_id: string
          prompt_version: string
          report_id: string
          terminal_outcome: string | null
          updated_at: string
        }
        Insert: {
          analysis_version: string
          content_hash: string
          created_at?: string
          expires_at: string
          id?: string
          lease_token?: string
          model_route_key: string
          owner_run_id: string
          prompt_version: string
          report_id: string
          terminal_outcome?: string | null
          updated_at?: string
        }
        Update: {
          analysis_version?: string
          content_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          lease_token?: string
          model_route_key?: string
          owner_run_id?: string
          prompt_version?: string
          report_id?: string
          terminal_outcome?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_research_report_analysis_leases_owner_run_id_fkey"
            columns: ["owner_run_id"]
            isOneToOne: false
            referencedRelation: "system_job_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_report_analysis_leases_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "market_research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_report_chunks: {
        Row: {
          chunk_hash: string
          chunk_index: number
          chunk_version: string
          content: string
          content_hash: string
          created_at: string
          id: string
          page_number: number
          report_id: string
          search_vector: unknown
        }
        Insert: {
          chunk_hash: string
          chunk_index: number
          chunk_version: string
          content: string
          content_hash: string
          created_at?: string
          id?: string
          page_number: number
          report_id: string
          search_vector?: unknown
        }
        Update: {
          chunk_hash?: string
          chunk_index?: number
          chunk_version?: string
          content?: string
          content_hash?: string
          created_at?: string
          id?: string
          page_number?: number
          report_id?: string
          search_vector?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "market_research_report_chunks_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "market_research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_report_run_items: {
        Row: {
          ai_request_count: number
          attempted_models: Json
          cache_write_tokens: number
          cached_input_tokens: number
          content_hash: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          estimated_cost_usd: number | null
          external_report_id: string
          finished_at: string | null
          id: string
          input_tokens: number
          job_key: string
          outcome: string | null
          output_tokens: number
          pricing_version: string | null
          provider: string
          publish_date: string
          reasoning_tokens: number
          report_id: string
          run_id: string
          started_at: string
          terminal_stage: string | null
          total_tokens: number
          unknown_usage_attempts: number
          updated_at: string
        }
        Insert: {
          ai_request_count?: number
          attempted_models?: Json
          cache_write_tokens?: number
          cached_input_tokens?: number
          content_hash?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          external_report_id: string
          finished_at?: string | null
          id?: string
          input_tokens?: number
          job_key: string
          outcome?: string | null
          output_tokens?: number
          pricing_version?: string | null
          provider: string
          publish_date: string
          reasoning_tokens?: number
          report_id: string
          run_id: string
          started_at?: string
          terminal_stage?: string | null
          total_tokens?: number
          unknown_usage_attempts?: number
          updated_at?: string
        }
        Update: {
          ai_request_count?: number
          attempted_models?: Json
          cache_write_tokens?: number
          cached_input_tokens?: number
          content_hash?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          external_report_id?: string
          finished_at?: string | null
          id?: string
          input_tokens?: number
          job_key?: string
          outcome?: string | null
          output_tokens?: number
          pricing_version?: string | null
          provider?: string
          publish_date?: string
          reasoning_tokens?: number
          report_id?: string
          run_id?: string
          started_at?: string
          terminal_stage?: string | null
          total_tokens?: number
          unknown_usage_attempts?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_research_report_run_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "market_research_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_report_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_report_ticker_mentions: {
        Row: {
          analysis_id: string
          created_at: string
          evidence: Json
          id: string
          rationale: string | null
          recommendation_text: string | null
          report_id: string
          stance: string
          target_currency: string | null
          target_price: number | null
          target_source: string | null
          ticker: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          evidence?: Json
          id?: string
          rationale?: string | null
          recommendation_text?: string | null
          report_id: string
          stance: string
          target_currency?: string | null
          target_price?: number | null
          target_source?: string | null
          ticker: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          evidence?: Json
          id?: string
          rationale?: string | null
          recommendation_text?: string | null
          report_id?: string
          stance?: string
          target_currency?: string | null
          target_price?: number | null
          target_source?: string | null
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_research_report_ticker_mentions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "market_research_report_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_report_ticker_mentions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "market_research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_reports: {
        Row: {
          analysis_error: string | null
          analysis_status: string
          category: string
          code: string | null
          content_hash: string | null
          created_at: string
          external_report_id: string
          id: string
          ingestion_error: string | null
          ingestion_status: string
          link: string | null
          original_type_report: string | null
          parsed_page_count: number
          pdf_url: string
          provider: string
          publish_date: string
          recommendation: string | null
          sector_name: string | null
          source_name: string
          source_payload: Json
          target_price: number | null
          title: string
          updated_at: string
        }
        Insert: {
          analysis_error?: string | null
          analysis_status?: string
          category: string
          code?: string | null
          content_hash?: string | null
          created_at?: string
          external_report_id: string
          id?: string
          ingestion_error?: string | null
          ingestion_status?: string
          link?: string | null
          original_type_report?: string | null
          parsed_page_count?: number
          pdf_url: string
          provider: string
          publish_date: string
          recommendation?: string | null
          sector_name?: string | null
          source_name: string
          source_payload: Json
          target_price?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          analysis_error?: string | null
          analysis_status?: string
          category?: string
          code?: string | null
          content_hash?: string | null
          created_at?: string
          external_report_id?: string
          id?: string
          ingestion_error?: string | null
          ingestion_status?: string
          link?: string | null
          original_type_report?: string | null
          parsed_page_count?: number
          pdf_url?: string
          provider?: string
          publish_date?: string
          recommendation?: string | null
          sector_name?: string | null
          source_name?: string
          source_payload?: Json
          target_price?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_universe_memberships: {
        Row: {
          average_volume_50d: number
          company_name: string | null
          created_at: string
          detail_complete: boolean
          exchange: string | null
          logo_kind: string
          logo_path: string
          market_cap_billion: number
          rank: number
          run_id: string
          sector: string | null
          source_as_of_date: string
          ticker: string
          universe_key: string
        }
        Insert: {
          average_volume_50d: number
          company_name?: string | null
          created_at?: string
          detail_complete?: boolean
          exchange?: string | null
          logo_kind: string
          logo_path: string
          market_cap_billion: number
          rank: number
          run_id: string
          sector?: string | null
          source_as_of_date: string
          ticker: string
          universe_key: string
        }
        Update: {
          average_volume_50d?: number
          company_name?: string | null
          created_at?: string
          detail_complete?: boolean
          exchange?: string | null
          logo_kind?: string
          logo_path?: string
          market_cap_billion?: number
          rank?: number
          run_id?: string
          sector?: string | null
          source_as_of_date?: string
          ticker?: string
          universe_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_universe_memberships_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "market_universe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_universe_runs: {
        Row: {
          candidate_count: number
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          max_size: number
          min_average_volume_50d: number
          min_market_cap_billion: number
          published_at: string | null
          selected_count: number
          source: string
          source_as_of_date: string
          started_at: string
          status: string
          universe_key: string
        }
        Insert: {
          candidate_count?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          max_size?: number
          min_average_volume_50d: number
          min_market_cap_billion: number
          published_at?: string | null
          selected_count?: number
          source?: string
          source_as_of_date: string
          started_at?: string
          status?: string
          universe_key: string
        }
        Update: {
          candidate_count?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          max_size?: number
          min_average_volume_50d?: number
          min_market_cap_billion?: number
          published_at?: string | null
          selected_count?: number
          source?: string
          source_as_of_date?: string
          started_at?: string
          status?: string
          universe_key?: string
        }
        Relationships: []
      }
      portfolio_transactions: {
        Row: {
          action: string
          created_at: string
          fee: number
          fee_rate: number
          id: string
          mistake_tags: string[]
          note: string | null
          portfolio_id: string
          price: number
          quantity: number
          setup_tags: string[]
          stop_loss_1: number | null
          stop_loss_2: number | null
          stop_loss_3: number | null
          tags: string[]
          target_price_1: number | null
          target_price_2: number | null
          target_price_3: number | null
          ticker: string
          transaction_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          fee?: number
          fee_rate?: number
          id?: string
          mistake_tags?: string[]
          note?: string | null
          portfolio_id: string
          price?: number
          quantity: number
          setup_tags?: string[]
          stop_loss_1?: number | null
          stop_loss_2?: number | null
          stop_loss_3?: number | null
          tags?: string[]
          target_price_1?: number | null
          target_price_2?: number | null
          target_price_3?: number | null
          ticker: string
          transaction_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          fee?: number
          fee_rate?: number
          id?: string
          mistake_tags?: string[]
          note?: string | null
          portfolio_id?: string
          price?: number
          quantity?: number
          setup_tags?: string[]
          stop_loss_1?: number | null
          stop_loss_2?: number | null
          stop_loss_3?: number | null
          tags?: string[]
          target_price_1?: number | null
          target_price_2?: number | null
          target_price_3?: number | null
          ticker?: string
          transaction_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_transactions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          created_at: string
          description: string | null
          id: string
          initial_capital: number
          is_default: boolean
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          initial_capital?: number
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          initial_capital?: number
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_orderbook_snapshots: {
        Row: {
          ceiling_price: number | null
          floor_price: number | null
          foreign_flow: Json | null
          intraday_1m: Json
          latest_price: number | null
          latest_quote: Json
          put_through: Json | null
          reference_price: number | null
          session_date: string
          symbol: string
          total_volume: number | null
          trades: Json
          trades_truncated: boolean | null
          updated_at: string
        }
        Insert: {
          ceiling_price?: number | null
          floor_price?: number | null
          foreign_flow?: Json | null
          intraday_1m?: Json
          latest_price?: number | null
          latest_quote?: Json
          put_through?: Json | null
          reference_price?: number | null
          session_date?: string
          symbol: string
          total_volume?: number | null
          trades?: Json
          trades_truncated?: boolean | null
          updated_at?: string
        }
        Update: {
          ceiling_price?: number | null
          floor_price?: number | null
          foreign_flow?: Json | null
          intraday_1m?: Json
          latest_price?: number | null
          latest_quote?: Json
          put_through?: Json | null
          reference_price?: number | null
          session_date?: string
          symbol?: string
          total_volume?: number | null
          trades?: Json
          trades_truncated?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      system_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after_value: Json | null
          before_value: Json | null
          created_at: string
          error_message: string | null
          id: number
          reason: string
          request_id: string
          success: boolean
          target_key: string
          target_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          error_message?: string | null
          id?: never
          reason: string
          request_id: string
          success: boolean
          target_key: string
          target_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          error_message?: string | null
          id?: never
          reason?: string
          request_id?: string
          success?: boolean
          target_key?: string
          target_type?: string
        }
        Relationships: []
      }
      system_job_phases: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_key: string
          phase_key: string
          phase_order: number
          run_id: string
          started_at: string
          status: string
          summary: Json
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_key: string
          phase_key: string
          phase_order: number
          run_id: string
          started_at?: string
          status: string
          summary?: Json
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_key?: string
          phase_key?: string
          phase_order?: number
          run_id?: string
          started_at?: string
          status?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_job_phases_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_job_runs: {
        Row: {
          actor_user_id: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_key: string
          provider: string
          provider_run_id: string | null
          started_at: string
          status: string
          summary: Json
          trigger: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_key: string
          provider: string
          provider_run_id?: string | null
          started_at?: string
          status: string
          summary?: Json
          trigger: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_key?: string
          provider?: string
          provider_run_id?: string | null
          started_at?: string
          status?: string
          summary?: Json
          trigger?: string
        }
        Relationships: []
      }
      system_job_ticker_attempts: {
        Row: {
          attempt: number
          created_at: string
          error_class: string | null
          error_code: string | null
          error_message: string | null
          id: number
          job_key: string
          retry_eligible: boolean
          run_id: string
          stage: string
          status: string
          ticker: string
        }
        Insert: {
          attempt: number
          created_at?: string
          error_class?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: never
          job_key: string
          retry_eligible?: boolean
          run_id: string
          stage: string
          status: string
          ticker: string
        }
        Update: {
          attempt?: number
          created_at?: string
          error_class?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: never
          job_key?: string
          retry_eligible?: boolean
          run_id?: string
          stage?: string
          status?: string
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_job_ticker_attempts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          change_reason: string
          created_at: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          version: number
        }
        Insert: {
          change_reason: string
          created_at?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          version?: number
        }
        Update: {
          change_reason?: string
          created_at?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          version?: number
        }
        Relationships: []
      }
      user_features: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          feature_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          feature_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          feature_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          compact_board: boolean
          created_at: string
          default_page: string
          settings: Json
          sound_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          compact_board?: boolean
          created_at?: string
          default_page?: string
          settings?: Json
          sound_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          compact_board?: boolean
          created_at?: string
          default_page?: string
          settings?: Json
          sound_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      watchlist_items: {
        Row: {
          alert_price_above: number | null
          alert_price_below: number | null
          created_at: string
          id: string
          note: string | null
          sort_order: number
          tags: string[]
          ticker: string
          updated_at: string
          user_id: string
          watchlist_id: string
        }
        Insert: {
          alert_price_above?: number | null
          alert_price_below?: number | null
          created_at?: string
          id?: string
          note?: string | null
          sort_order?: number
          tags?: string[]
          ticker: string
          updated_at?: string
          user_id: string
          watchlist_id: string
        }
        Update: {
          alert_price_above?: number | null
          alert_price_below?: number | null
          created_at?: string
          id?: string
          note?: string | null
          sort_order?: number
          tags?: string[]
          ticker?: string
          updated_at?: string
          user_id?: string
          watchlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_items_watchlist_id_user_id_fkey"
            columns: ["watchlist_id", "user_id"]
            isOneToOne: false
            referencedRelation: "watchlists"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      watchlists: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wyckoff_analysis_snapshots: {
        Row: {
          aggregation_version: string
          bar_closed_at: string
          base_probability: number | null
          bear_probability: number | null
          bull_probability: number | null
          confidence: string | null
          confirmation: string | null
          evidence: Json
          history_bar_count: number
          history_status: string
          id: string
          invalidation: string | null
          markers: Json
          model_version: string
          phase: string | null
          prompt_version: string
          published_at: string
          resistance: string | null
          run_id: string
          scenarios: Json
          support: string | null
          ta_bias: string | null
          technical: Json
          ticker: string
          timeframe: string
          what_changed: string | null
          wyckoff_state: string | null
        }
        Insert: {
          aggregation_version: string
          bar_closed_at: string
          base_probability?: number | null
          bear_probability?: number | null
          bull_probability?: number | null
          confidence?: string | null
          confirmation?: string | null
          evidence?: Json
          history_bar_count: number
          history_status: string
          id: string
          invalidation?: string | null
          markers?: Json
          model_version: string
          phase?: string | null
          prompt_version?: string
          published_at?: string
          resistance?: string | null
          run_id: string
          scenarios?: Json
          support?: string | null
          ta_bias?: string | null
          technical: Json
          ticker: string
          timeframe: string
          what_changed?: string | null
          wyckoff_state?: string | null
        }
        Update: {
          aggregation_version?: string
          bar_closed_at?: string
          base_probability?: number | null
          bear_probability?: number | null
          bull_probability?: number | null
          confidence?: string | null
          confirmation?: string | null
          evidence?: Json
          history_bar_count?: number
          history_status?: string
          id?: string
          invalidation?: string | null
          markers?: Json
          model_version?: string
          phase?: string | null
          prompt_version?: string
          published_at?: string
          resistance?: string | null
          run_id?: string
          scenarios?: Json
          support?: string | null
          ta_bias?: string | null
          technical?: Json
          ticker?: string
          timeframe?: string
          what_changed?: string | null
          wyckoff_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wyckoff_analysis_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "wyckoff_scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wyckoff_build_artifacts: {
        Row: {
          created_at: string
          ordinal: number
          run_id: string
          run_key: string
          scan_date: string
          snapshots: Json
          ticker: string
          validation_hash: string
        }
        Insert: {
          created_at?: string
          ordinal: number
          run_id: string
          run_key: string
          scan_date: string
          snapshots: Json
          ticker: string
          validation_hash: string
        }
        Update: {
          created_at?: string
          ordinal?: number
          run_id?: string
          run_key?: string
          scan_date?: string
          snapshots?: Json
          ticker?: string
          validation_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "wyckoff_build_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wyckoff_chart_series: {
        Row: {
          aggregation_version: string
          as_of: string
          bars: Json
          derived: boolean
          model_version: string
          provider: string
          provider_detail: string
          run_id: string
          ticker: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          aggregation_version: string
          as_of: string
          bars: Json
          derived?: boolean
          model_version: string
          provider: string
          provider_detail?: string
          run_id: string
          ticker: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          aggregation_version?: string
          as_of?: string
          bars?: Json
          derived?: boolean
          model_version?: string
          provider?: string
          provider_detail?: string
          run_id?: string
          ticker?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wyckoff_chart_series_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "wyckoff_scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wyckoff_scan_runs: {
        Row: {
          aggregation_version: string
          completed_count: number
          diagnostics: Json
          error_count: number
          finished_at: string | null
          id: string
          incomplete_count: number
          model_version: string
          prompt_version: string
          requested_at: string
          requested_count: number
          started_at: string
          status: string
          universe_effective_date: string
          universe_key: string
        }
        Insert: {
          aggregation_version: string
          completed_count?: number
          diagnostics?: Json
          error_count?: number
          finished_at?: string | null
          id: string
          incomplete_count?: number
          model_version: string
          prompt_version?: string
          requested_at?: string
          requested_count?: number
          started_at?: string
          status: string
          universe_effective_date: string
          universe_key?: string
        }
        Update: {
          aggregation_version?: string
          completed_count?: number
          diagnostics?: Json
          error_count?: number
          finished_at?: string | null
          id?: string
          incomplete_count?: number
          model_version?: string
          prompt_version?: string
          requested_at?: string
          requested_count?: number
          started_at?: string
          status?: string
          universe_effective_date?: string
          universe_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      wyckoff_latest_by_timeframe: {
        Row: {
          aggregation_version: string | null
          bar_closed_at: string | null
          base_probability: number | null
          bear_probability: number | null
          bull_probability: number | null
          confidence: string | null
          confirmation: string | null
          evidence: Json | null
          history_bar_count: number | null
          history_status: string | null
          id: string | null
          invalidation: string | null
          markers: Json | null
          model_version: string | null
          phase: string | null
          published_at: string | null
          resistance: string | null
          run_id: string | null
          scenarios: Json | null
          support: string | null
          ta_bias: string | null
          technical: Json | null
          ticker: string | null
          timeframe: string | null
          what_changed: string | null
          wyckoff_state: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wyckoff_analysis_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "wyckoff_scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_market_ai_conclusion: {
        Args: {
          p_as_of: string
          p_evidence_hash: string
          p_evidence_manifest: Json
          p_policy_version: string
          p_prompt_version: string
          p_schema_version: string
          p_session_date: string
          p_snapshot_id: string
        }
        Returns: {
          attempt_count: number
          claim_token: string
          id: string
          status: string
        }[]
      }
      complete_market_ai_conclusion: {
        Args: {
          p_claim_token: string
          p_cost: number
          p_error_code: string
          p_id: string
          p_input_tokens: number
          p_manifest: Json
          p_model: string
          p_output_tokens: number
          p_payload: Json
          p_posture: string
          p_status: string
        }
        Returns: boolean
      }
      dispatch_market_ai_conclusion: {
        Args: { p_mode: string; p_session_date?: string }
        Returns: number
      }
      mark_market_ai_completion_unknown: {
        Args: { p_claim_token: string; p_error_code?: string; p_id: string }
        Returns: boolean
      }
      publish_kfsp_rating_snapshot: {
        Args: { p_minimum_rows?: number; p_sync_run_id: string }
        Returns: number
      }
      publish_market_insight_snapshot: {
        Args: { p_sync_run_id: string }
        Returns: Json
      }
      publish_market_insight_snapshot_v2: {
        Args: { p_sync_run_id: string }
        Returns: Json
      }
      qeo_acquire_research_report_analysis_lease: {
        Args: {
          p_analysis_version: string
          p_content_hash: string
          p_model_route_key: string
          p_prompt_version: string
          p_report_id: string
          p_run_id: string
          p_ttl_seconds?: number
        }
        Returns: {
          analysis_id: string
          expires_at: string
          lease_token: string
          outcome: string
        }[]
      }
      qeo_admin_cron_snapshot: { Args: never; Returns: Json }
      qeo_admin_reset_system_setting: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_key: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      qeo_admin_set_system_setting: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_key: string
          p_reason: string
          p_request_id: string
          p_value: Json
        }
        Returns: Json
      }
      qeo_begin_kfsp_manual_lifecycle: {
        Args: { p_job_key: string; p_request_id: string; p_sync_run_id: string }
        Returns: Json
      }
      qeo_current_market_universe: {
        Args: { p_universe_key?: string }
        Returns: Json
      }
      qeo_dispatch_kfsp_job: {
        Args: {
          p_actor_user_id?: string
          p_force?: boolean
          p_job_key: string
          p_max_duration_minutes?: number
          p_reason: string
          p_request_id: string
          p_requested_by?: string
          p_tickers?: string[]
        }
        Returns: {
          dispatched_at: string
          duplicate: boolean
          job_key: string
          net_request_id: number
          request_id: string
          status: string
          sync_run_id: string
          system_job_run_id: string
        }[]
      }
      qeo_finalize_kfsp_manual_lifecycle: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_job_key: string
          p_request_id: string
          p_success: boolean
          p_summary?: Json
        }
        Returns: Json
      }
      qeo_get_kfsp_credentials: { Args: never; Returns: Json }
      qeo_get_kfsp_provider_token_cache: { Args: never; Returns: Json }
      qeo_get_market_close_sync_secret: { Args: never; Returns: string }
      qeo_market_ohlcv_coverage: {
        Args: { p_tickers: string[] }
        Returns: {
          distinct_months: number
          first_bar_time: string
          last_bar_time: string
          row_count: number
          ticker: string
          timeframe: string
        }[]
      }
      qeo_market_ohlcv_recent: {
        Args: { p_limit?: number; p_tickers: string[] }
        Returns: {
          bar_time: string
          close: number
          fetched_at: string
          high: number
          low: number
          open: number
          provider: string
          provider_detail: string
          source_url: string
          ticker: string
          timeframe: string
          volume: number
        }[]
      }
      qeo_market_ohlcv_recent_grouped: {
        Args: { p_limit?: number; p_tickers: string[] }
        Returns: {
          rows: Json
          ticker: string
        }[]
      }
      qeo_prune_noncanonical_orderbook_snapshots: {
        Args: { p_run_id: string }
        Returns: number
      }
      qeo_prune_verified_chart_intraday_partition: {
        Args: {
          p_expected_row_count: number
          p_expected_sha256: string
          p_manifest_id: string
        }
        Returns: Json
      }
      qeo_publish_market_universe_run: {
        Args: { p_run_id: string }
        Returns: Json
      }
      qeo_publish_research_report_analysis: {
        Args: {
          p_analysis: Json
          p_chunks: Json
          p_content_hash: string
          p_mentions: Json
          p_report_id: string
        }
        Returns: string
      }
      qeo_release_research_report_analysis_lease: {
        Args: { p_lease_token: string; p_terminal_outcome: string }
        Returns: boolean
      }
      qeo_run_job_telemetry_cleanup: {
        Args: { p_reference_at?: string }
        Returns: Json
      }
      qeo_run_safe_retention_cleanup: {
        Args: { p_reference_at?: string }
        Returns: Json
      }
      qeo_run_wyckoff_build_artifact_cleanup: {
        Args: { p_reference_at?: string }
        Returns: Json
      }
      qeo_search_research_report_chunks: {
        Args: {
          p_chunk_version: string
          p_content_hash: string
          p_limit?: number
          p_query: string
          p_report_id: string
        }
        Returns: {
          chunk_index: number
          chunk_version: string
          content: string
          content_hash: string
          id: string
          page_number: number
          rank: number
          report_id: string
        }[]
      }
      qeo_select_market_universe_candidates: {
        Args: {
          p_max_size?: number
          p_min_average_volume_50d: number
          p_min_market_cap_billion: number
          p_source_date: string
        }
        Returns: {
          activity_observation_days: number
          activity_positive_days: number
          as_of_date: string
          average_volume_50_sessions: number
          company_name: string
          eligible_candidate_count: number
          exchange: string
          market_cap_billion: number
          sector: string
          ticker: string
        }[]
      }
      qeo_set_kfsp_provider_token_cache: {
        Args: { p_access_token: string; p_expires_at: string }
        Returns: undefined
      }
      qeo_trigger_eod_pipeline: { Args: never; Returns: number }
      qeo_trigger_eod_pipeline_backfill: {
        Args: { p_session_date: string }
        Returns: number
      }
      qeo_trigger_market_snapshot_bootstrap: { Args: never; Returns: number }
      qeo_trigger_market_universe_monthly: { Args: never; Returns: number }
      qeo_trigger_research_reports_daily: { Args: never; Returns: number }
      qeo_verify_eod_scheduler_secret: {
        Args: { p_secret: string }
        Returns: boolean
      }
      qeo_verify_market_ai_dispatch_secret: {
        Args: { p_secret: string }
        Returns: boolean
      }
      refresh_ai_council_agent_stats: {
        Args: { p_as_of_date?: string }
        Returns: number
      }
      refresh_ai_council_confirmations: {
        Args: { p_expiry_sessions?: number }
        Returns: number
      }
      refresh_ai_council_outcomes: { Args: never; Returns: number }
      start_market_ai_conclusion_model: {
        Args: { p_claim_token: string; p_id: string }
        Returns: boolean
      }
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

