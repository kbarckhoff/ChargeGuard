// ─── Enums ───────────────────────────────────────────────────
export type UserRole = "admin" | "auditor" | "reviewer" | "manager" | "viewer";
export type AuditStatus = "draft" | "in_progress" | "on_hold" | "completed" | "archived";
export type PhaseStatus = "not_started" | "in_progress" | "review" | "completed";
export type TaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "blocked";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "open" | "in_review" | "accepted" | "rejected" | "resolved";
export type CdmColor = "red" | "blue" | "green" | "purple" | "none";
export type ClaimType =
  | "interventional_radiology" | "pacemaker" | "cath_lab" | "angiography"
  | "surgical" | "chemotherapy" | "observation" | "emergency_room"
  | "blood_transfusion" | "rehab" | "diagnostic_imaging" | "wound_care"
  | "clinical_lab" | "iv_infusions" | "ob_outpatient" | "smoking_cessation"
  | "medical_nutritional_therapy" | "sleep_lab" | "pulmonary_rehab" | "cardiac_rehab"
  | "other";
export type MeetingStatus = "scheduled" | "completed" | "cancelled" | "rescheduled";

// ─── Tables ──────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  slug: string;
  address?: string;
  contact_email?: string;
  contact_phone?: string;
  logo_url?: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url?: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
  updated_at: string;
}

export interface Audit {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  hospital_name: string;
  status: AuditStatus;
  lead_auditor_id?: string;
  start_date?: string;
  target_end_date?: string;
  actual_end_date?: string;
  data_received_date?: string;
  total_charge_items: number;
  total_findings: number;
  total_claims_target: number;
  total_claims_reviewed: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditPhase {
  id: string;
  audit_id: string;
  org_id: string;
  phase_number: number;
  name: string;
  description?: string;
  status: PhaseStatus;
  start_date?: string;
  end_date?: string;
  completion_pct: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditTask {
  id: string;
  phase_id: string;
  audit_id: string;
  org_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  sort_order: number;
  assigned_to?: string;
  due_date?: string;
  completed_at?: string;
  completed_by?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChargeItem {
  id: string;
  audit_id: string;
  org_id: string;
  procedure_number?: string;
  charge_description: string;
  hcpcs_cpt_code?: string;
  revenue_code?: string;
  department?: string;
  department_gl?: string;
  gross_charge?: number;
  cdm_color: CdmColor;
  is_invalid_code: boolean;
  unit_of_service?: string;
  units_billed: number;
  ndc_code?: string;
  is_self_admin_drug: boolean;
  is_dme: boolean;
  is_implant: boolean;
  service_line?: string;
  clinical_lab_fee?: number;
  professional_fee?: number;
  dme_fee?: number;
  apc_payment?: number;
  apc_status?: string;
  market_price?: number;
  modifier_1?: string;
  modifier_2?: string;
  modifier_3?: string;
  is_active: boolean;
  raw_data: Record<string, unknown>;
  column_mapping: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Finding {
  id: string;
  audit_id: string;
  phase_id?: string;
  org_id: string;
  charge_item_id?: string;
  claim_review_id?: string;
  title: string;
  description?: string;
  severity: FindingSeverity;
  status: FindingStatus;
  category?: string;
  financial_impact?: number;
  recommendation?: string;
  assigned_to?: string;
  resolved_at?: string;
  resolved_by?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ClaimReview {
  id: string;
  audit_id: string;
  org_id: string;
  claim_type: ClaimType;
  patient_control_number: string;
  claim_date?: string;
  total_charges?: number;
  type_of_bill?: string;
  payer: string;
  is_reviewed: boolean;
  reviewed_by?: string;
  reviewed_at?: string;
  errors_found: number;
  notes?: string;
  supporting_docs?: string[];
  created_at: string;
  updated_at: string;
}

export interface ClaimReviewItem {
  id: string;
  claim_review_id: string;
  org_id: string;
  line_number?: number;
  revenue_code?: string;
  hcpcs_code?: string;
  description?: string;
  units?: number;
  charge_amount?: number;
  error_code?: string;
  error_description?: string;
  corrected_code?: string;
  corrected_units?: number;
  corrected_amount?: number;
  is_missing_charge: boolean;
  is_compliance_issue: boolean;
  notes?: string;
  created_at: string;
}

export interface DepartmentMeeting {
  id: string;
  audit_id: string;
  org_id: string;
  department: string;
  scheduled_date?: string;
  scheduled_time?: string;
  estimated_hours: number;
  actual_hours?: number;
  location?: string;
  status: MeetingStatus;
  attendees?: string[];
  agenda?: string;
  notes?: string;
  action_items: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  audit_id: string;
  org_id: string;
  title: string;
  description?: string;
  report_format: "pdf" | "excel";
  report_view: "summary" | "detail";
  sort_by: string;
  filters: Record<string, unknown>;
  file_path?: string;
  file_size?: number;
  generated_by?: string;
  generated_at?: string;
  created_at: string;
}

export interface Comment {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  body: string;
  author_id: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CdmImportConfig {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  column_mappings: Record<string, string>;
  sample_headers?: string[];
  is_default: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// ─── Column Mapping ──────────────────────────────────────────
export interface TargetColumn {
  key: string;
  label: string;
  required: boolean;
}

export const CDM_TARGET_COLUMNS: TargetColumn[] = [
  { key: "procedure_number", label: "Procedure Number", required: false },
  { key: "charge_description", label: "Charge Description", required: true },
  { key: "hcpcs_cpt_code", label: "HCPCS/CPT Code", required: true },
  { key: "revenue_code", label: "Revenue Code", required: true },
  { key: "department", label: "Department", required: false },
  { key: "department_gl", label: "Department G/L", required: false },
  { key: "gross_charge", label: "Gross Charge", required: true },
  { key: "unit_of_service", label: "Unit of Service", required: false },
  { key: "units_billed", label: "Units Billed", required: false },
  { key: "ndc_code", label: "NDC Code", required: false },
  { key: "modifier_1", label: "Modifier 1", required: false },
  { key: "modifier_2", label: "Modifier 2", required: false },
  { key: "service_line", label: "Service Line", required: false },
];
