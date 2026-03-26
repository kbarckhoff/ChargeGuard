-- ============================================================
-- ChargeGuard CDM Audit Platform — Supabase Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for fuzzy text search

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'auditor', 'reviewer', 'manager', 'viewer');
CREATE TYPE audit_status AS ENUM ('draft', 'in_progress', 'on_hold', 'completed', 'archived');
CREATE TYPE phase_status AS ENUM ('not_started', 'in_progress', 'review', 'completed');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'blocked');
CREATE TYPE finding_severity AS ENUM ('critical', 'high', 'medium', 'low', 'info');
CREATE TYPE finding_status AS ENUM ('open', 'in_review', 'accepted', 'rejected', 'resolved');
CREATE TYPE cdm_color AS ENUM ('red', 'blue', 'green', 'purple', 'none');
CREATE TYPE claim_type AS ENUM (
  'interventional_radiology', 'pacemaker', 'cath_lab', 'angiography',
  'surgical', 'chemotherapy', 'observation', 'emergency_room',
  'blood_transfusion', 'rehab', 'diagnostic_imaging', 'wound_care',
  'clinical_lab', 'iv_infusions', 'ob_outpatient', 'smoking_cessation',
  'medical_nutritional_therapy', 'sleep_lab', 'pulmonary_rehab', 'cardiac_rehab',
  'other'
);
CREATE TYPE meeting_status AS ENUM ('scheduled', 'completed', 'cancelled', 'rescheduled');
CREATE TYPE report_format AS ENUM ('pdf', 'excel');
CREATE TYPE report_view AS ENUM ('summary', 'detail');

-- ============================================================
-- ORGANIZATIONS (Tenant Boundary)
-- ============================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  address TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  logo_url TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- AUDITS
-- ============================================================

CREATE TABLE audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  hospital_name TEXT NOT NULL,
  status audit_status NOT NULL DEFAULT 'draft',
  lead_auditor_id UUID REFERENCES users(id),
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  data_received_date DATE,
  total_charge_items INTEGER DEFAULT 0,
  total_findings INTEGER DEFAULT 0,
  total_claims_target INTEGER DEFAULT 100,
  total_claims_reviewed INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audits_org ON audits(org_id);
CREATE INDEX idx_audits_status ON audits(status);

-- ============================================================
-- AUDIT PHASES (7 per audit)
-- ============================================================

CREATE TABLE audit_phases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL CHECK (phase_number BETWEEN 1 AND 7),
  name TEXT NOT NULL,
  description TEXT,
  status phase_status NOT NULL DEFAULT 'not_started',
  start_date DATE,
  end_date DATE,
  completion_pct NUMERIC(5,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(audit_id, phase_number)
);

CREATE INDEX idx_phases_audit ON audit_phases(audit_id);

-- ============================================================
-- AUDIT TASKS (checklists within phases)
-- ============================================================

CREATE TABLE audit_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase_id UUID NOT NULL REFERENCES audit_phases(id) ON DELETE CASCADE,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'pending',
  sort_order INTEGER DEFAULT 0,
  assigned_to UUID REFERENCES users(id),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_phase ON audit_tasks(phase_id);
CREATE INDEX idx_tasks_audit ON audit_tasks(audit_id);
CREATE INDEX idx_tasks_status ON audit_tasks(status);

-- ============================================================
-- CHARGE ITEMS (CDM line items — 10k+ per hospital)
-- ============================================================

CREATE TABLE charge_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Core CDM fields
  procedure_number TEXT,
  charge_description TEXT NOT NULL,
  hcpcs_cpt_code TEXT,
  revenue_code TEXT,
  department TEXT,
  department_gl TEXT,
  gross_charge NUMERIC(12,2),
  -- Coding validation
  cdm_color cdm_color DEFAULT 'none',
  is_invalid_code BOOLEAN DEFAULT false,
  -- Unit of service
  unit_of_service TEXT,
  units_billed INTEGER DEFAULT 1,
  -- Pharmacy specific
  ndc_code TEXT,
  is_self_admin_drug BOOLEAN DEFAULT false,
  -- Classification
  is_dme BOOLEAN DEFAULT false,
  is_implant BOOLEAN DEFAULT false,
  service_line TEXT,
  -- Pricing
  clinical_lab_fee NUMERIC(12,2),
  professional_fee NUMERIC(12,2),
  dme_fee NUMERIC(12,2),
  apc_payment NUMERIC(12,2),
  apc_status TEXT,
  market_price NUMERIC(12,2),
  -- Modifiers
  modifier_1 TEXT,
  modifier_2 TEXT,
  modifier_3 TEXT,
  -- Status
  is_active BOOLEAN DEFAULT true,
  -- Raw import data (preserves original columns)
  raw_data JSONB DEFAULT '{}',
  -- Column mapping metadata
  column_mapping JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_charge_items_audit ON charge_items(audit_id);
CREATE INDEX idx_charge_items_hcpcs ON charge_items(hcpcs_cpt_code);
CREATE INDEX idx_charge_items_revenue ON charge_items(revenue_code);
CREATE INDEX idx_charge_items_dept ON charge_items(department);
CREATE INDEX idx_charge_items_color ON charge_items(cdm_color);
CREATE INDEX idx_charge_items_desc_trgm ON charge_items USING gin(charge_description gin_trgm_ops);

-- ============================================================
-- CHARGE ITEM RECOMMENDATIONS (green/purple changes)
-- ============================================================

CREATE TABLE charge_item_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_item_id UUID NOT NULL REFERENCES charge_items(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_type cdm_color NOT NULL CHECK (recommendation_type IN ('green', 'purple')),
  field_name TEXT NOT NULL,
  current_value TEXT,
  recommended_value TEXT NOT NULL,
  rationale TEXT,
  is_accepted BOOLEAN,
  accepted_by UUID REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recommendations_item ON charge_item_recommendations(charge_item_id);

-- ============================================================
-- FINDINGS
-- ============================================================

CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES audit_phases(id) ON DELETE SET NULL,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  charge_item_id UUID REFERENCES charge_items(id) ON DELETE SET NULL,
  claim_review_id UUID,  -- FK added after claim_reviews table
  title TEXT NOT NULL,
  description TEXT,
  severity finding_severity NOT NULL DEFAULT 'medium',
  status finding_status NOT NULL DEFAULT 'open',
  category TEXT,
  financial_impact NUMERIC(12,2),
  recommendation TEXT,
  assigned_to UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_findings_audit ON findings(audit_id);
CREATE INDEX idx_findings_phase ON findings(phase_id);
CREATE INDEX idx_findings_severity ON findings(severity);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_charge ON findings(charge_item_id);

-- ============================================================
-- CLAIM REVIEWS (Phase IV)
-- ============================================================

CREATE TABLE claim_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  claim_type claim_type NOT NULL,
  patient_control_number TEXT NOT NULL,  -- de-identified ID (UB04 box 3)
  claim_date DATE,
  total_charges NUMERIC(12,2),
  -- UB04 fields
  type_of_bill TEXT,
  payer TEXT DEFAULT 'Medicare',
  -- Review status
  is_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  -- Summary
  errors_found INTEGER DEFAULT 0,
  notes TEXT,
  supporting_docs TEXT[],  -- storage paths
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_claims_audit ON claim_reviews(audit_id);
CREATE INDEX idx_claims_type ON claim_reviews(claim_type);

-- Add FK from findings to claim_reviews
ALTER TABLE findings ADD CONSTRAINT fk_findings_claim
  FOREIGN KEY (claim_review_id) REFERENCES claim_reviews(id) ON DELETE SET NULL;

-- ============================================================
-- CLAIM REVIEW ITEMS (line-level corrections)
-- ============================================================

CREATE TABLE claim_review_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_review_id UUID NOT NULL REFERENCES claim_reviews(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_number INTEGER,
  revenue_code TEXT,
  hcpcs_code TEXT,
  description TEXT,
  units INTEGER,
  charge_amount NUMERIC(12,2),
  -- Correction
  error_code TEXT,
  error_description TEXT,
  corrected_code TEXT,
  corrected_units INTEGER,
  corrected_amount NUMERIC(12,2),
  is_missing_charge BOOLEAN DEFAULT false,
  is_compliance_issue BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_claim_items_review ON claim_review_items(claim_review_id);

-- ============================================================
-- DEPARTMENT MEETINGS (Phase V)
-- ============================================================

CREATE TABLE department_meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  scheduled_date DATE,
  scheduled_time TIME,
  estimated_hours NUMERIC(3,1) DEFAULT 1,
  actual_hours NUMERIC(3,1),
  location TEXT,
  status meeting_status DEFAULT 'scheduled',
  attendees TEXT[],
  agenda TEXT,
  notes TEXT,
  action_items JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meetings_audit ON department_meetings(audit_id);

-- ============================================================
-- DEPARTMENT FEEDBACK (action items from meetings)
-- ============================================================

CREATE TABLE department_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID NOT NULL REFERENCES department_meetings(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  feedback_text TEXT NOT NULL,
  is_resolved BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_meeting ON department_feedback(meeting_id);

-- ============================================================
-- PRICING COMPARISONS (Phase VI)
-- ============================================================

CREATE TABLE pricing_comparisons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_item_id UUID NOT NULL REFERENCES charge_items(id) ON DELETE CASCADE,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comparison_type TEXT NOT NULL,  -- 'clinical_lab_fee', 'professional_fee', 'dme_fee', 'apc_t', 'apc_s', 'apc_x', 'market'
  current_price NUMERIC(12,2),
  benchmark_price NUMERIC(12,2),
  variance NUMERIC(12,2),
  variance_pct NUMERIC(8,2),
  is_below_benchmark BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pricing_charge ON pricing_comparisons(charge_item_id);
CREATE INDEX idx_pricing_audit ON pricing_comparisons(audit_id);

-- ============================================================
-- REPORTS (Phase VII)
-- ============================================================

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  report_format report_format NOT NULL DEFAULT 'pdf',
  report_view report_view NOT NULL DEFAULT 'summary',
  sort_by TEXT DEFAULT 'hcpcs_code',
  filters JSONB DEFAULT '{}',
  file_path TEXT,  -- Supabase Storage path
  file_size INTEGER,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_audit ON reports(audit_id);

-- ============================================================
-- COMMENTS (polymorphic — on any entity)
-- ============================================================

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Polymorphic reference
  entity_type TEXT NOT NULL,  -- 'audit', 'finding', 'charge_item', 'claim_review', 'task'
  entity_id UUID NOT NULL,
  -- Content
  body TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES users(id),
  parent_id UUID REFERENCES comments(id),  -- for threading
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_entity ON comments(entity_type, entity_id);
CREATE INDEX idx_comments_author ON comments(author_id);

-- ============================================================
-- ATTACHMENTS (Supabase Storage references)
-- ============================================================

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,  -- Supabase Storage path
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- ============================================================
-- AUDIT LOG (immutable history)
-- ============================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL,
  user_id UUID,
  action TEXT NOT NULL,  -- 'create', 'update', 'delete', 'status_change'
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_org ON audit_log(org_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- ============================================================
-- CDM IMPORT MAPPINGS (for CSV column mapping)
-- ============================================================

CREATE TABLE cdm_import_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  column_mappings JSONB NOT NULL DEFAULT '{}',
  -- Example: {"Proc #": "procedure_number", "Description": "charge_description", "HCPCS": "hcpcs_cpt_code"}
  sample_headers TEXT[],
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_import_configs_org ON cdm_import_configs(org_id);

-- ============================================================
-- PHASE TEMPLATES (seed data for auto-creating audit phases)
-- ============================================================

CREATE TABLE phase_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE task_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CLAIM TYPE TARGETS (minimum claims per type from PARA spec)
-- ============================================================

CREATE TABLE claim_type_targets (
  claim_type claim_type PRIMARY KEY,
  description TEXT NOT NULL,
  minimum_claims INTEGER NOT NULL,
  supporting_docs TEXT NOT NULL
);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at'
    AND table_schema = 'public'
    AND table_name NOT IN ('audit_log')
  LOOP
    EXECUTE format('
      CREATE TRIGGER trg_%I_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      t, t);
  END LOOP;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE charge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE charge_item_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdm_import_configs ENABLE ROW LEVEL SECURITY;

-- Helper function: get user's org_id
CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS UUID AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Generic RLS policy for all org-scoped tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'org_id'
    AND table_schema = 'public'
  LOOP
    EXECUTE format('
      CREATE POLICY %I ON %I
      FOR ALL USING (org_id = auth.user_org_id())',
      'policy_' || t || '_org', t);
  END LOOP;
END;
$$;

-- Phase templates and task templates are global (no RLS needed, read-only)
ALTER TABLE phase_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_phase_templates_read ON phase_templates FOR SELECT USING (true);

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_task_templates_read ON task_templates FOR SELECT USING (true);

ALTER TABLE claim_type_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_claim_type_targets_read ON claim_type_targets FOR SELECT USING (true);

-- ============================================================
-- SEED DATA: Phase Templates
-- ============================================================

INSERT INTO phase_templates (phase_number, name, description) VALUES
(1, 'Coding Review', 'Review of HCPCS/CPT codes, revenue codes, NDC codes, units of service, and pharmacy classifications. Identifies invalid codes, SAD drugs, DME items, and consistency issues.'),
(2, 'Charge Compliance & Modifiers', 'Review line items for Medicare billing compliance using Wheatlands keywords and validate all hard-coded modifiers in the charge master.'),
(3, 'Code Assignment Validation', 'Validate correct code assignment using CMS Addendum B service line filters. Identify codes used inconsistently or missing from the CDM.'),
(4, 'Claim Review', 'Review minimum 100 Medicare outpatient claims across all service categories. Identify missing charges, compliance errors, and billing issues.'),
(5, 'Department Review', 'On-site interactive discussions with revenue department managers. Review charge capture, coding accuracy, and department-specific issues.'),
(6, 'Pricing Validation', 'Compare charge master prices against CMS fee schedules (Clinical Lab, Professional, DME) and APC reimbursement. Review market pricing data.'),
(7, 'Reporting & Implementation', 'Generate final audit reports, format implementation files, and coordinate charge master updates with the hospital information system.');

-- ============================================================
-- SEED DATA: Task Templates (mapped from PARA document)
-- ============================================================

INSERT INTO task_templates (phase_number, title, description, sort_order) VALUES
-- Phase I: Coding Review
(1, 'Invalid HCPCS/Revenue Code Filter', 'Run the Invalid filter to identify line items with incorrect codes (displayed in red). Review recommended changes (green).', 1),
(1, 'Unit of Service Review (per ml/sq cm)', 'Identify items billed by unit of service per HCPCS description. Verify charges and billing system unit adjustments.', 2),
(1, 'Pharmacy SAD J-Code Review', 'Review self-administered drug J-codes against Medicare SAD list. Verify coding and patient billing setup.', 3),
(1, 'Pharmacy SAD Keyword Search', 'Keyword search for potential SAD items not correctly coded. Review and assign correct billing codes.', 4),
(1, 'DME OPPS Exempt Review', 'Identify items billable with DME codes and 0274 revenue code. Generate report for Materials Management L-code review.', 5),
(1, 'Code Consistency Check', 'Review third-party indicator mappings across code types (CPT, Medicare, Medicaid, WC). Identify background code discrepancies.', 6),
(1, 'Blood Charge Review (038X)', 'Review blood charges to prevent blood deductible issues with 038X revenue code series.', 7),
(1, 'ED/Urgent Care/Clinic Procedures', 'Review department charges for technical portion billing of physician procedures and separately billable nursing procedures.', 8),
(1, 'Radiology Interventional Procedures', 'Review imaging departments to ensure all surgical procedures are correctly coded and charged.', 9),
(1, 'Implant Revenue Code Review', 'Review keyword-matched items to verify implant revenue codes are correctly assigned.', 10),
(1, 'Pharmacy NDC-to-J-Code Audit', 'Process pharmacy NDC data through CMS NDC-to-HCPCS audit file. Identify invalid NDCs, incorrect J-codes, and wrong units.', 11),

-- Phase II: Compliance & Modifiers
(2, 'Compliance Keyword Review (Wheatlands)', 'Run compliance ID filter using Medicare billable item keywords from Wheatlands PDF. Identify items that should not be billed to the Program.', 1),
(2, 'Hard-Coded Modifier Review', 'Review all modifiers hard-coded in the charge master. Verify auto-application of modifiers is correct for all affected items.', 2),

-- Phase III: Code Validation
(3, 'Service Line Filter Review (Addendum B)', 'Review CPT/HCPCS codes by service line using CMS Addendum B groupings. Identify incorrect assignments and missing codes.', 1),
(3, 'Cross-Hospital Code Consistency', 'For multi-hospital groups: compare coding, descriptions, and pricing across facilities for consistent code assignment.', 2),
(3, 'Usage & Pricing Inconsistency Check', 'Identify codes where assigned services are inconsistent with other items using the same code, or where pricing appears incorrect.', 3),

-- Phase IV: Claim Review
(4, 'Interventional Radiology Claims (min 8)', 'Review breast biopsy, cyst aspiration, percutaneous biopsy, pain injection claims. Supporting: Radiology Reports.', 1),
(4, 'Pacemaker Claims (min 4)', 'Review initial placement and replacement claims. Supporting: Cath Lab/Surgical Report, HIM abstract.', 2),
(4, 'Cath Lab Claims (min 6)', 'Review left heart, combo left & right heart, stent placement claims. Supporting: Cath Lab Report.', 3),
(4, 'Angiography Claims (min 8)', 'Review stent placement, aortogram, declot fistula, dialysis fistula claims. Supporting: Procedure Report.', 4),
(4, 'Surgical Claims (min 8)', 'Review simple to complex surgeries, multiple procedures, bilateral/unilateral. Supporting: Surgical Report, HIM Abstract.', 5),
(4, 'Chemotherapy Claims (min 4)', 'Review multiple infusions, hydration, clinical visits, injections. Supporting: Nursing Notes.', 6),
(4, 'Observation Claims (min 4)', 'Review ER observation admits and direct physician office admits. Supporting: Physician Notes, Orders, Nursing Notes.', 7),
(4, 'Emergency Room Claims (min 5)', 'Review critical care, surgical procedures, blood transfusion, IV infusions, injections. Supporting: Physician/Nursing Notes, ER level form.', 8),
(4, 'Blood Transfusion Claims (min 3)', 'Review standalone or cross-area blood transfusion claims. Supporting: Nursing Notes.', 9),
(4, 'Rehab Claims (min 4)', 'Review PT, OT, Speech claims with evaluation and therapy charges. Supporting: Therapist Notes.', 10),
(4, 'Diagnostic Imaging Claims (min 12)', 'Review Radiology, CT, Nuclear Med, Mammography, MRI, Ultrasound claims. Supporting: Radiology Reports.', 11),
(4, 'Wound Care Claims (min 6)', 'Review new office visit, recurring visit, graft, debridement, hyperbaric. Supporting: Nursing Notes.', 12),
(4, 'Clinical Lab Claims (min 4)', 'Review multi-test single claims. Supporting: Lab Information System listing.', 13),
(4, 'IV Infusion Claims (min 6)', 'Review hydrations, infusions, and injections. Supporting: Nursing Notes.', 14),
(4, 'OB Outpatient Claims (min 4)', 'Review non-stress tests, monitoring, IV therapy. Supporting: Nursing Notes.', 15),
(4, 'Smoking Cessation Claims (min 2)', 'Review complete course of care claims. Supporting: Procedure Notes.', 16),
(4, 'Medical Nutritional Therapy Claims (min 4)', 'Review diabetes self-management training claims. Supporting: Procedure Notes.', 17),
(4, 'Sleep Lab Claims (min 4)', 'Review overnight study, CPAP titration, home study claims. Supporting: Procedure Notes.', 18),
(4, 'Pulmonary Rehab Claims (min 2)', 'Review complete course of care claims. Supporting: Procedure Notes.', 19),
(4, 'Cardiac Rehab Claims (min 2)', 'Review complete course of care claims. Supporting: Procedure Notes.', 20),

-- Phase V: Department Review
(5, 'Business Office Review', 'First meeting: review current issues to frame the remainder of meetings. Est: 1 hour.', 1),
(5, 'Cardiology Review', 'Review EEG, EKG, Echocardiography, Cardiac Rehab charges. Est: 1 hour.', 2),
(5, 'Emergency Room / Trauma Review', 'Review ER and trauma charges, coding, and compliance. Est: 1 hour.', 3),
(5, 'Inpatient Daily Hospital Services Review', 'Review daily service charges and room rates. Est: 1 hour.', 4),
(5, 'Labor and Delivery Review', 'Review L&D charges and coding. Est: 1 hour.', 5),
(5, 'Laboratory / Pathology / Blood Bank Review', 'Review lab, pathology, and blood bank charges. Est: 1.5 hours.', 6),
(5, 'Materials / Medical-Surgical Supplies Review', 'Review supply charges and DME coding. Est: 1 hour.', 7),
(5, 'Outpatient / Ambulatory Nursing Review', 'Review outpatient nursing procedure charges. Est: 1 hour.', 8),
(5, 'Pharmacy Review', 'Review pharmacy charges, NDC codes, J-codes, and units. Est: 1 hour.', 9),
(5, 'Radiology / Imaging Review', 'Review Diagnostic, US, MRI, CT, Nuclear Med, Fluoroscopy, Mammography, Interventional. Est: 2 hours.', 10),
(5, 'Rehab Services Review', 'Review PT, OT, Speech charges. Est: 1 hour.', 11),
(5, 'Respiratory / Pulmonary / Sleep Lab Review', 'Review respiratory therapy, pulmonary function, sleep lab charges. Est: 1 hour.', 12),
(5, 'Surgical Services Review', 'Review OR charges, surgical supply coding, implants. Est: 1 hour.', 13),
(5, 'Women''s Center Review', 'Review women''s center charges and coding. Est: 1 hour.', 14),

-- Phase VI: Pricing Validation
(6, 'Clinical Lab Fee Schedule Comparison', 'Compare charge master prices against CMS Clinical Lab fee schedule. Identify items priced below benchmark.', 1),
(6, 'Professional Fee Schedule Comparison', 'Compare prices against Medicare Professional (Physician) fee schedule.', 2),
(6, 'DME Fee Schedule Comparison', 'Compare prices against Medicare DME fee schedule.', 3),
(6, 'APC Status T/Q1/Q2/Q3 Comparison', 'Compare prices against APC reimbursement for Status T, Q1, Q2, Q3 items.', 4),
(6, 'APC Status S Comparison', 'Compare prices against APC reimbursement for Status S (significant procedures).', 5),
(6, 'APC Status X Comparison', 'Compare prices against APC reimbursement for ancillary Status X items.', 6),
(6, 'Market Pricing Review', 'Review charges against current peer market pricing data.', 7),

-- Phase VII: Reporting & Implementation
(7, 'Generate Summary Audit Report', 'Build filtered report in summary view. Select sort order and format (PDF/Excel).', 1),
(7, 'Generate Detail Audit Report', 'Build filtered report in detail view with all data elements, corrections, and descriptions.', 2),
(7, 'Format Implementation File', 'Create file with header and trailer data elements for hospital information system upload.', 3),
(7, 'Coordinate HIS Update', 'Work with hospital IT to implement code and price updates. Verify changes via Boston Workstation or equivalent.', 4),
(7, 'Quarterly Update Plan', 'Document plan for quarterly charge master updates per Medicare coding regulation changes.', 5);

-- ============================================================
-- SEED DATA: Claim Type Targets
-- ============================================================

INSERT INTO claim_type_targets (claim_type, description, minimum_claims, supporting_docs) VALUES
('interventional_radiology', 'Breast Biopsy, Cyst Aspiration, Percutaneous Biopsy, Pain Injections', 8, 'Radiology Report'),
('pacemaker', 'Initial Placement and Replacements', 4, 'Cath Lab/Surgical Report and HIM abstract'),
('cath_lab', 'Left Heart, Combo Left & Right Heart, Stent Placement', 6, 'Cath Lab Report'),
('angiography', 'Stent Placement, Aortogram with runoff, Declot Fistula, Dialysis Fistula', 8, 'Procedure Report'),
('surgical', 'Simple to complex surgeries, multiple procedures, bilateral and unilateral', 8, 'Surgical Report and HIM Abstract'),
('chemotherapy', 'Multiple infusions, hydration, clinical visits, injections', 4, 'Nursing Notes'),
('observation', 'ER observation admits, direct admit from physician office', 4, 'Physician Notes, Orders, Nursing Notes'),
('emergency_room', 'Critical care, surgical procedures, blood transfusion, IV infusions, injections', 5, 'Physician and Nursing Notes, ER level form'),
('blood_transfusion', 'Standalone or cross-area blood transfusion claims', 3, 'Nursing Notes'),
('rehab', 'PT, OT, Speech — evaluation and therapy charges', 4, 'Therapist Notes'),
('diagnostic_imaging', 'Radiology, CT, Nuclear Med, Mammography, MRI, Ultrasound', 12, 'Radiology Reports'),
('wound_care', 'New visit, recurring visit, graft, debridement, hyperbaric', 6, 'Nursing Notes'),
('clinical_lab', 'Multiple tests on a single claim', 4, 'Lab Information System listing'),
('iv_infusions', 'Hydrations, Infusions and Injections', 6, 'Nursing Notes'),
('ob_outpatient', 'Non Stress tests, monitoring, IV Therapy', 4, 'Nursing Notes'),
('smoking_cessation', 'Complete course of care', 2, 'Procedure Notes'),
('medical_nutritional_therapy', 'Diabetes self management training', 4, 'Procedure Notes'),
('sleep_lab', 'Complete overnight study, CPAP titration, home studies', 4, 'Procedure Notes'),
('pulmonary_rehab', 'Complete course of care', 2, 'Procedure Notes'),
('cardiac_rehab', 'Complete course of care', 2, 'Procedure Notes');

-- ============================================================
-- HELPER FUNCTION: Create audit with phases and tasks
-- ============================================================

CREATE OR REPLACE FUNCTION create_audit_with_phases(
  p_org_id UUID,
  p_name TEXT,
  p_hospital_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_lead_auditor_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
  v_phase RECORD;
  v_phase_id UUID;
  v_task RECORD;
BEGIN
  -- Create the audit
  INSERT INTO audits (org_id, name, hospital_name, description, lead_auditor_id, start_date, status)
  VALUES (p_org_id, p_name, p_hospital_name, p_description, p_lead_auditor_id, p_start_date, 'draft')
  RETURNING id INTO v_audit_id;

  -- Create phases from templates
  FOR v_phase IN SELECT * FROM phase_templates ORDER BY phase_number LOOP
    INSERT INTO audit_phases (audit_id, org_id, phase_number, name, description)
    VALUES (v_audit_id, p_org_id, v_phase.phase_number, v_phase.name, v_phase.description)
    RETURNING id INTO v_phase_id;

    -- Create tasks from templates for this phase
    FOR v_task IN SELECT * FROM task_templates WHERE phase_number = v_phase.phase_number ORDER BY sort_order LOOP
      INSERT INTO audit_tasks (phase_id, audit_id, org_id, title, description, sort_order)
      VALUES (v_phase_id, v_audit_id, p_org_id, v_task.title, v_task.description, v_task.sort_order);
    END LOOP;
  END LOOP;

  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STORAGE BUCKETS (run via Supabase dashboard or API)
-- ============================================================
-- Create these buckets in Supabase Storage:
--   cdm-imports    (for CSV uploads)
--   claim-docs     (for supporting documentation)
--   report-exports (for generated reports)
--   attachments    (general file attachments)
