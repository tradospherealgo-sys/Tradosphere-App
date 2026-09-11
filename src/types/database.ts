/**
 * Hand-authored types mirroring supabase/migrations/*.sql.
 *
 * `Table<Row, Required>` collapses the Row/Insert/Update triple PostgREST's
 * client expects into a single declaration, so a schema change is a one-line
 * edit here rather than three. Once a real project is linked these can be
 * replaced wholesale with `supabase gen types typescript` output — see README.
 */

export type AppRole = "user" | "admin";
export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "PENDING" | "FILLED" | "REJECTED" | "CANCELLED";
/** SL = stop-loss limit, SL_M = stop-loss market. */
export type OrderVariety = "MARKET" | "LIMIT" | "SL" | "SL_M";
/** CNC = delivery (no intraday STT relief), MIS = intraday. */
export type OrderProduct = "CNC" | "MIS";
export type OrderEventKind =
  | "PLACED"
  | "MODIFIED"
  | "TRIGGERED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";
export type InstrumentKind = "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION";
export type NotificationKind =
  | "system"
  | "trade"
  | "signal"
  | "education"
  | "announcement";
export type Verdict = "BULLISH" | "BEARISH" | "NEUTRAL";

export type SignalSourceKind =
  | "smc_specialist"
  | "smc_auto_trender"
  | "tradosphere_ai"
  | "telegram_channel"
  | "whatsapp_group"
  | "api_connector"
  | "manual";

export type SignalStatus =
  | "pending"
  | "active"
  | "triggered"
  | "target_hit"
  | "stopped_out"
  | "expired"
  | "cancelled";

export type VerificationState = "unverified" | "verified" | "rejected";

/** Signal OS classification. Only F&O/EQUITY/COMMODITY are ever tradeable —
 *  the rest are informational content a desk sends that a client should
 *  still see, just without a direction or a stop-loss. */
export type SignalCategory =
  | "F&O"
  | "EQUITY"
  | "COMMODITY"
  | "IPO"
  | "SIP"
  | "MUTUAL_FUND"
  | "INVESTMENT"
  | "INSURANCE"
  | "LOAN"
  | "MARKET_UPDATE"
  | "EDUCATION"
  | "OTHER";

export type RawMessageChannel = "telegram" | "whatsapp" | "api" | "manual";
export type RawMessageParseStatus =
  | "pending"
  | "classified"
  | "validated"
  | "quarantined"
  | "duplicate"
  | "published"
  | "rejected";
export type DistributionDestination = "telegram" | "whatsapp" | "dashboard";
export type DistributionStatus = "pending" | "sent" | "failed" | "retrying";

export type BillingInterval = "monthly" | "quarterly" | "yearly";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "expired"
  | "cancelled";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type LessonKind = "text" | "video" | "slides" | "pdf" | "quiz";

/** A structured prose block used by lesson bodies and agent rationales. */
/** A heading is optional — a standalone paragraph is a valid block. */
export type ProseBlock = {
  h?: string;
  p: string;
}

/**
 * Shape of one foreign key as PostgREST reports it. Declaring a relationship
 * here is what lets `.select("*, child(*)")` resolve to a typed embed instead
 * of a SelectQueryError — so only the FKs actually used in embedded selects
 * need to be listed.
 */
type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<
  Row,
  RequiredOnInsert extends keyof Row = never,
  Rels extends Relationship[] = [],
> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, RequiredOnInsert>;
  Update: Partial<Row>;
  Relationships: Rels;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PaperAccount = {
  id: string;
  user_id: string;
  starting_capital: number;
  cash_balance: number;
  /** Buying power held by resting BUY orders. Free cash = cash − reserved. */
  reserved_cash: number;
  risk_per_trade_pct: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export type Order = {
  id: string;
  account_id: string;
  user_id: string;
  symbol: string;
  instrument_kind: InstrumentKind;
  side: OrderSide;
  quantity: number;
  /** Null until the order fills — a resting order has no traded price. */
  price: number | null;
  variety: OrderVariety;
  product: OrderProduct;
  limit_price: number | null;
  trigger_price: number | null;
  filled_quantity: number;
  avg_fill_price: number | null;
  reserved_cash: number;
  brokerage: number;
  stt: number;
  exchange_charges: number;
  sebi_charges: number;
  stamp_duty: number;
  gst: number;
  total_charges: number;
  status: OrderStatus;
  reject_reason: string | null;
  quote_source: string | null;
  quote_as_of: string | null;
  stop_loss: number | null;
  target_price: number | null;
  notes: string | null;
  signal_id: string | null;
  filled_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Append-only lifecycle log. Written only by the order RPCs. */
export type OrderEvent = {
  id: string;
  order_id: string;
  user_id: string;
  event: OrderEventKind;
  detail: Record<string, unknown>;
  created_at: string;
}

export type Position = {
  id: string;
  account_id: string;
  user_id: string;
  symbol: string;
  instrument_kind: InstrumentKind;
  side: OrderSide;
  quantity: number;
  avg_price: number;
  product: OrderProduct;
  /** Charges paid to open the remaining quantity; apportioned on partial exits. */
  entry_charges: number;
  stop_loss: number | null;
  target_price: number | null;
  opened_at: string;
  updated_at: string;
}

export type Trade = {
  id: string;
  account_id: string;
  user_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entry_price: number;
  exit_price: number;
  /** Gross of charges. `net_realized_pnl` is what the account actually kept. */
  realized_pnl: number;
  product: OrderProduct;
  entry_charges: number;
  exit_charges: number;
  total_charges: number;
  net_realized_pnl: number;
  stop_loss: number | null;
  target_price: number | null;
  r_multiple: number | null;
  opened_at: string;
  closed_at: string;
  origin: string | null;
  notes: string | null;
  signal_id: string | null;
}

export type Instrument = {
  id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  instrument_kind: InstrumentKind;
  lot_size: number;
  tick_size: number;
  is_index: boolean;
  is_active: boolean;
  provider_token: string | null;
  sort_order: number;
  updated_at: string;
}

export type SignalSource = {
  id: string;
  slug: string;
  name: string;
  kind: SignalSourceKind;
  description: string | null;
  telegram_chat_id: string | null;
  is_trusted: boolean;
  is_active: boolean;
  auto_verify: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type Signal = {
  id: string;
  source_id: string;
  symbol: string;
  instrument_name: string | null;
  exchange: string | null;
  instrument_kind: InstrumentKind;
  category: SignalCategory;
  /** Null for non-trade categories (IPO, SIP, MUTUAL_FUND, INVESTMENT,
   *  INSURANCE, LOAN, MARKET_UPDATE, EDUCATION, OTHER). Required by a
   *  database check constraint for F&O/EQUITY/COMMODITY. */
  direction: OrderSide | null;
  entry_price: number | null;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  target_3: number | null;
  /** Generated column — null unless entry, stop and target were all published. */
  risk_reward: number | null;
  confidence: number | null;
  rationale: string | null;
  risk_note: string | null;
  status: SignalStatus;
  verification_state: VerificationState;
  verified_by: string | null;
  verified_at: string | null;
  origin_ref: string | null;
  raw_message: string | null;
  normalized_message: string | null;
  timeframe: string | null;
  source_message_id: string | null;
  source_timestamp: string | null;
  ai_model: string | null;
  fingerprint: string | null;
  issued_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RawSignalMessage = {
  id: number;
  source_id: string | null;
  channel: RawMessageChannel;
  external_chat_id: string | null;
  external_message_id: string | null;
  sender: string | null;
  raw_text: string;
  raw_payload: Record<string, unknown>;
  normalized_text: string | null;
  ai_category: SignalCategory | null;
  ai_confidence: number | null;
  ai_extraction: Record<string, unknown> | null;
  ai_model: string | null;
  fingerprint: string | null;
  parse_status: RawMessageParseStatus;
  quarantine_reason: string | null;
  signal_id: string | null;
  received_at: string;
  processed_at: string | null;
}

export type DistributionLog = {
  id: number;
  signal_id: string;
  destination: DistributionDestination;
  status: DistributionStatus;
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowError = {
  id: number;
  workflow_name: string;
  node_name: string;
  stage: string;
  error_message: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
}

export type SignalEvent = {
  id: number;
  signal_id: string;
  event_type: string;
  detail: string | null;
  payload: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
}

export type TelegramInboxRow = {
  id: number;
  chat_id: string;
  message_id: number;
  sender: string | null;
  text: string;
  raw: Record<string, unknown>;
  source_id: string | null;
  parse_status: "pending" | "parsed" | "unparseable" | "ignored";
  parse_error: string | null;
  signal_id: string | null;
  received_at: string;
}

export type Plan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  billing_interval: BillingInterval;
  price_minor: number;
  currency: string;
  entitlements: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type Subscription = {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
  cancelled_at: string | null;
  source: "admin_grant" | "payment_gateway";
  external_ref: string | null;
  granted_by: string | null;
  expiry_warned_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Payment = {
  id: string;
  user_id: string;
  plan_id: string;
  subscription_id: string | null;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  gateway: string | null;
  gateway_ref: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type Course = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  cover_url: string | null;
  level: "beginner" | "intermediate" | "advanced";
  is_free: boolean;
  required_entitlement: string | null;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CourseModule = {
  id: string;
  course_id: string;
  title: string;
  summary: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type Lesson = {
  id: string;
  module_id: string;
  slug: string;
  title: string;
  blurb: string | null;
  kind: LessonKind;
  body: ProseBlock[];
  asset_url: string | null;
  minutes: number;
  sort_order: number;
  is_preview: boolean;
  created_at: string;
  updated_at: string;
}

export type LessonProgress = {
  id: string;
  user_id: string;
  lesson_id: string;
  progress_pct: number;
  completed_at: string | null;
  updated_at: string;
}

export type CourseEnrollment = {
  id: string;
  user_id: string;
  course_id: string;
  enrolled_at: string;
  completed_at: string | null;
}

export type CoachMessage = {
  id: number;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type Notification = {
  id: string;
  user_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

export type IntegrationConfig = {
  id: string;
  provider: string;
  config: Record<string, unknown>;
  secret_env_var: string | null;
  is_enabled: boolean;
  last_tested_at: string | null;
  last_test_result: Record<string, unknown> | null;
  updated_by: string | null;
  updated_at: string;
}

export type AuditLog = {
  id: number;
  actor_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type AgentVerdict = {
  id: string;
  symbol: string;
  agent_name: string;
  focus: string | null;
  verdict: Verdict;
  confidence: number | null;
  thesis: string | null;
  rationale: ProseBlock[] | null;
  suggested_action: string | null;
  generated_at: string;
}

export type Watchlist = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export type WatchlistItem = {
  id: string;
  watchlist_id: string;
  symbol: string;
  added_at: string;
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, "id" | "email">;
      paper_accounts: Table<
        PaperAccount,
        "user_id",
        [
          {
            foreignKeyName: "paper_accounts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      orders: Table<
        Order,
        "account_id" | "user_id" | "symbol" | "side" | "quantity",
        [
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      order_events: Table<OrderEvent, "order_id" | "user_id" | "event">;
      positions: Table<
        Position,
        "account_id" | "user_id" | "symbol" | "side" | "quantity" | "avg_price",
        [
          {
            foreignKeyName: "positions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      trades: Table<
        Trade,
        | "account_id"
        | "user_id"
        | "symbol"
        | "side"
        | "quantity"
        | "entry_price"
        | "exit_price"
        | "realized_pnl"
        | "opened_at"
      >;
      instruments: Table<Instrument, "symbol">;
      watchlists: Table<Watchlist, "user_id">;
      watchlist_items: Table<
        WatchlistItem,
        "watchlist_id" | "symbol",
        [
          {
            foreignKeyName: "watchlist_items_watchlist_id_fkey";
            columns: ["watchlist_id"];
            isOneToOne: false;
            referencedRelation: "watchlists";
            referencedColumns: ["id"];
          },
        ]
      >;
      market_data_cache: Table<
        {
          symbol: string;
          name: string | null;
          last_price: number | null;
          prev_close: number | null;
          day_open: number | null;
          day_high: number | null;
          day_low: number | null;
          volume: number | null;
          as_of: string | null;
          source: string;
          raw: unknown;
          updated_at: string;
        },
        "symbol" | "source"
      >;
      ohlc_candles: Table<
        {
          id: number;
          symbol: string;
          interval: string;
          ts: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number | null;
          source: string;
        },
        "symbol" | "interval" | "ts" | "open" | "high" | "low" | "close" | "source"
      >;
      option_chain_snapshots: Table<
        {
          id: number;
          underlying: string;
          expiry: string;
          strike: number;
          option_type: "CE" | "PE";
          ltp: number | null;
          bid: number | null;
          ask: number | null;
          volume: number | null;
          oi: number | null;
          change_oi: number | null;
          iv: number | null;
          delta: number | null;
          gamma: number | null;
          theta: number | null;
          vega: number | null;
          spot_at_capture: number | null;
          source: string;
          captured_at: string;
        },
        "underlying" | "expiry" | "strike" | "option_type" | "source"
      >;
      signal_sources: Table<SignalSource, "slug" | "name" | "kind">;
      signals: Table<
        Signal,
        "source_id" | "symbol" | "direction",
        [
          {
            foreignKeyName: "signals_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "signal_sources";
            referencedColumns: ["id"];
          },
        ]
      >;
      signal_events: Table<SignalEvent, "signal_id" | "event_type">;
      telegram_inbox: Table<
        TelegramInboxRow,
        "chat_id" | "message_id" | "text" | "raw"
      >;
      raw_signal_messages: Table<
        RawSignalMessage,
        "channel" | "raw_text",
        [
          {
            foreignKeyName: "raw_signal_messages_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "signal_sources";
            referencedColumns: ["id"];
          },
        ]
      >;
      distribution_logs: Table<
        DistributionLog,
        "signal_id" | "destination",
        [
          {
            foreignKeyName: "distribution_logs_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
        ]
      >;
      workflow_errors: Table<
        WorkflowError,
        "workflow_name" | "node_name" | "stage" | "error_message"
      >;
      plans: Table<Plan, "slug" | "name" | "billing_interval" | "price_minor">;
      subscriptions: Table<
        Subscription,
        "user_id" | "plan_id" | "current_period_end",
        [
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      payments: Table<
        Payment,
        "user_id" | "plan_id" | "amount_minor",
        [
          {
            foreignKeyName: "payments_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ]
      >;
      courses: Table<Course, "slug" | "title">;
      course_modules: Table<
        CourseModule,
        "course_id" | "title",
        [
          {
            foreignKeyName: "course_modules_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ]
      >;
      lessons: Table<
        Lesson,
        "module_id" | "slug" | "title",
        [
          {
            foreignKeyName: "lessons_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "course_modules";
            referencedColumns: ["id"];
          },
        ]
      >;
      lesson_progress: Table<LessonProgress, "user_id" | "lesson_id">;
      course_enrollments: Table<CourseEnrollment, "user_id" | "course_id">;
      coach_messages: Table<CoachMessage, "user_id" | "role" | "content">;
      ai_agent_verdicts: Table<AgentVerdict, "symbol" | "agent_name" | "verdict">;
      notifications: Table<Notification, "title">;
      integration_configs: Table<IntegrationConfig, "id" | "provider">;
      system_settings: Table<
        {
          key: string;
          value: unknown;
          description: string | null;
          updated_by: string | null;
          updated_at: string;
        },
        "key" | "value"
      >;
      audit_logs: Table<AuditLog, "action">;
    };
    Views: Record<string, never>;
    Functions: {
      place_paper_order: {
        Args: {
          p_symbol: string;
          p_side: string;
          p_quantity: number;
          p_variety?: OrderVariety;
          p_product?: OrderProduct;
          /** The live quote. Required for MARKET; also used to test whether a
           *  resting order's condition is already satisfied on arrival. */
          p_price?: number | null;
          p_limit_price?: number | null;
          p_trigger_price?: number | null;
          p_instrument_kind?: string;
          p_quote_source?: string | null;
          p_quote_as_of?: string | null;
          p_stop_loss?: number | null;
          p_target_price?: number | null;
          p_signal_id?: string | null;
          p_notes?: string | null;
        };
        Returns: Order;
      };
      cancel_paper_order: { Args: { p_order_id: string }; Returns: Order };
      modify_paper_order: {
        Args: {
          p_order_id: string;
          p_quantity?: number | null;
          p_limit_price?: number | null;
          p_trigger_price?: number | null;
        };
        Returns: Order;
      };
      execute_pending_order: {
        Args: {
          p_order_id: string;
          p_price: number;
          p_quote_source?: string | null;
          p_quote_as_of?: string | null;
        };
        Returns: Order;
      };
      update_position_risk: {
        Args: {
          p_position_id: string;
          p_stop_loss?: number | null;
          p_target_price?: number | null;
        };
        Returns: Position;
      };
      reset_paper_account: { Args: Record<string, never>; Returns: PaperAccount };
      admin_set_user_role: { Args: { p_user_id: string; p_role: AppRole }; Returns: Profile };
      admin_set_user_active: {
        Args: { p_user_id: string; p_is_active: boolean };
        Returns: Profile;
      };
      bootstrap_first_admin: { Args: { p_email: string }; Returns: Profile };
      write_audit_log: {
        Args: {
          p_action: string;
          p_target_table?: string | null;
          p_target_id?: string | null;
          p_metadata?: Record<string, unknown>;
        };
        Returns: void;
      };
      admin_verify_signal: { Args: { p_signal_id: string; p_release?: boolean }; Returns: Signal };
      system_release_signal: { Args: { p_signal_id: string }; Returns: Signal };
      admin_update_signal_status: {
        Args: { p_signal_id: string; p_status: SignalStatus; p_detail?: string | null };
        Returns: Signal;
      };
      ingest_classified_signal: {
        Args: {
          p_source_id: string;
          p_raw_message_id: number | null;
          p_category: SignalCategory;
          p_symbol: string;
          p_instrument_name?: string | null;
          p_exchange?: string | null;
          p_instrument_kind?: InstrumentKind;
          p_direction?: OrderSide | null;
          p_entry_price?: number | null;
          p_entry_low?: number | null;
          p_entry_high?: number | null;
          p_stop_loss?: number | null;
          p_target_1?: number | null;
          p_target_2?: number | null;
          p_target_3?: number | null;
          p_expiry?: string | null;
          p_timeframe?: string | null;
          p_confidence?: number | null;
          p_rationale?: string | null;
          p_raw_message?: string | null;
          p_normalized_message?: string | null;
          p_source_message_id?: string | null;
          p_source_timestamp?: string | null;
          p_fingerprint?: string | null;
          p_ai_model?: string | null;
        };
        Returns: Signal;
      };
      quarantine_raw_message: {
        Args: { p_raw_message_id: number; p_reason: string };
        Returns: RawSignalMessage;
      };
      log_distribution: {
        Args: {
          p_signal_id: string;
          p_destination: DistributionDestination;
          p_status: DistributionStatus;
          p_error?: string | null;
        };
        Returns: DistributionLog;
      };
      log_workflow_error: {
        Args: {
          p_workflow_name: string;
          p_node_name: string;
          p_stage: string;
          p_error_message: string;
          p_payload?: Record<string, unknown>;
        };
        Returns: WorkflowError;
      };
      admin_grant_subscription: {
        Args: { p_user_id: string; p_plan_id: string };
        Returns: Subscription;
      };
      admin_cancel_subscription: { Args: { p_subscription_id: string }; Returns: Subscription };
      admin_suspend_subscription: {
        Args: { p_subscription_id: string; p_reason: string | null };
        Returns: Subscription;
      };
      admin_unsuspend_subscription: { Args: { p_subscription_id: string }; Returns: Subscription };
      start_checkout: { Args: { p_plan_id: string }; Returns: Payment };
      record_payment_success: {
        Args: { p_payment_id: string; p_gateway: string; p_gateway_ref: string };
        Returns: Subscription;
      };
      expire_lapsed_subscriptions: { Args: Record<string, never>; Returns: number };
      warn_expiring_subscriptions: { Args: { p_days: number }; Returns: number };
      current_entitlements: { Args: Record<string, never>; Returns: string[] };
      has_entitlement: { Args: { p_key: string }; Returns: boolean };
      can_access_course: { Args: { p_course_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
