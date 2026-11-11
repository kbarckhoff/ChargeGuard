// ─── Structural (within-CDM) rules ──────────────────────────
// Extracted verbatim from the scan route so the hosted app AND the standalone
// CONVERGE engine run the SAME structural rule code (one source of truth).
import type { RuleResult } from "./cdm-reference-rules";
import { getReference, normalizeHcpcs } from "./cms-reference";

const REV_CODES_REQUIRING_HCPCS = [
  "025", "026", "027", "030", "031", "032", "033", "034", "035",
  "036", "037", "040", "041", "042", "043", "044", "045", "046",
  "047", "048", "049", "050", "051", "052", "053", "054", "055",
  "056", "057", "058", "059", "060", "061", "062", "063", "064",
  "070", "071", "072", "073", "074", "075", "076", "077", "078",
  "080", "082", "083", "084", "085", "088", "090", "091", "094",
];

// Lab Panel Crosswalk (from the reference "Lab Panel Crosswalk" tab)
const LAB_PANELS: Record<string, { name: string; components: string[]; allRequired: boolean }> = {
  "80047": { name: "Basic Metabolic Panel (Calcium, Ionized)", components: ["82330", "82374", "82435", "82565", "82947", "84132", "84295", "84520"], allRequired: true },
  "80048": { name: "Basic Metabolic Panel (Calcium, Total)", components: ["82310", "82374", "82435", "82565", "82974", "84132", "84295", "84520"], allRequired: true },
  "80051": { name: "Electrolyte Panel", components: ["82374", "82435", "84132", "84295"], allRequired: true },
  "80053": { name: "Comprehensive Metabolic Panel", components: ["82040", "82247", "82310", "82374", "82435", "82565", "82947", "84132", "84155", "84295", "84460", "84450", "84520"], allRequired: true },
  "80055": { name: "Obstetric Panel", components: ["85027", "85007", "85009", "85025", "85027", "85004", "86900", "86901", "87340", "86850", "86762", "86592"], allRequired: true },
  "80061": { name: "Lipid Panel", components: ["82465", "83718", "84478"], allRequired: true },
  "80069": { name: "Renal Function Panel", components: ["82040", "82310", "82374", "82435", "82565", "82947", "84100", "84132", "84295", "84520"], allRequired: true },
  "80074": { name: "Acute Hepatitis Panel", components: ["86709", "86705", "87340", "86803"], allRequired: true },
  "80076": { name: "Hepatic Function Panel", components: ["82040", "82248", "82247", "84075", "84155", "84460", "84450"], allRequired: true },
  "80081": { name: "Obstetric Panel (includes HIV testing)", components: ["85027", "85007", "85009", "85205", "85027", "85004", "86900", "86901", "87340", "87389", "86850", "86762", "86592"], allRequired: true },
};

// Radiology Crosswalk (from the reference "Radiology Crosswalk" tab)
const RADIOLOGY_LATERALITY: Record<string, { desc: string; lateralityReq: boolean; allowedMods: string[]; bilateral: string }> = {
  "70030": { desc: "Radiologic examination, eye, for detection of ", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "70120": { desc: "Radiologic examination, mastoids; less than 3 ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "70130": { desc: "Radiologic examination, mastoids; complete, mi", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "70328": { desc: "Radiologic examination, temporomandibular join", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "71100": { desc: "Radiologic examination, ribs, unilateral; 2 vi", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "71101": { desc: "Radiologic examination, ribs, unilateral; incl", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "73000": { desc: "Radiologic examination, clavicle; complete", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73010": { desc: "Radiologic examination, scapula; complete", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73020": { desc: "Radiologic examination, shoulder; 1 view", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73030": { desc: "Radiologic examination, shoulder, complete, mi", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73040": { desc: "Radiologic examination, shoulder; arthrography", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73060": { desc: "Radiologic examination, humerus; minimum 2 vie", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73070": { desc: "Radiologic examination, elbow; 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73080": { desc: "Radiologic examination, elbow; minimum 3 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73085": { desc: "Radiologic examination, elbow; arthrography, r", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73090": { desc: "Radiologic examination, forearm; 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73092": { desc: "Radiologic examination, infant upper extremity", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73100": { desc: "Radiologic examination, wrist; 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73110": { desc: "Radiologic examination, wrist; complete, minim", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73115": { desc: "Radiologic examination, wrist; arthrography, r", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73120": { desc: "Radiologic examination, hand; 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73130": { desc: "Radiologic examination, hand; minimum 3 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73140": { desc: "Radiologic examination, finger(s), minimum 2 v", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73200": { desc: "Computed tomography, upper extremity; without ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73201": { desc: "Computed tomography, upper extremity; with con", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73202": { desc: "Computed tomography, upper extremity; without ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73206": { desc: "Computed tomographic angiography, upper extrem", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73218": { desc: "Magnetic resonance (eg, proton) imaging, upper", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73219": { desc: "Magnetic resonance (eg, proton) imaging, upper", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73220": { desc: "Magnetic resonance (eg, proton) imaging, upper", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73221": { desc: "Magnetic resonance (eg, proton) imaging, any j", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73222": { desc: "Magnetic resonance (eg, proton) imaging, any j", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73223": { desc: "Magnetic resonance (eg, proton) imaging, any j", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73225": { desc: "Magnetic resonance angiography, upper extremit", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73501": { desc: "Radiologic examination, hip unilateral, with p", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73502": { desc: "Radiologic examination, hip unilateral, with p", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73503": { desc: "Radiologic examination, hip unilateral, with p", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73525": { desc: "Radiologic examination, hip, arthrography, rad", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73551": { desc: "Radiologic examination, femur; 1 view", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73552": { desc: "Radiologic examination, femur; minimum 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73560": { desc: "Radiologic examination, knee; 1 or 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73562": { desc: "Radiologic examination, knee; 3 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73564": { desc: "Radiologic examination, knee; complete, 4 or m", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73580": { desc: "Radiologic examination, knee, arthrography, ra", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73590": { desc: "Radiologic examination, tibia and fibula; 2 vi", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73592": { desc: "Radiologic examination, infant lower extremity", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73600": { desc: "Radiologic examination, ankle; 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73610": { desc: "Radiologic examination, ankle; complete, minim", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73615": { desc: "Radiologic examination, ankle; arthrography, r", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73620": { desc: "Radiologic examination, foot; 2 views", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73630": { desc: "Radiologic examination, foot; complete, minimu", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73650": { desc: "Radiologic examination, calcaneus; minimum 2 v", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73660": { desc: "Radiologic examination, toe(s), minimum 2 view", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73700": { desc: "Computed tomography, lower extremity; without ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73701": { desc: "Computed tomography, lower extremity; with con", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73702": { desc: "Computed tomography, lower extremity; without ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73706": { desc: "Computed tomographic angiography, lower extrem", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73718": { desc: "Magnetic resonance (eg, proton) imaging, lower", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73719": { desc: "Magnetic resonance (eg, proton) imaging, lower", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73720": { desc: "Magnetic resonance (eg, proton) imaging, lower", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73721": { desc: "Magnetic resonance (eg, proton) imaging, any j", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73722": { desc: "Magnetic resonance (eg, proton) imaging, any j", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73723": { desc: "Magnetic resonance (eg, proton) imaging, any j", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "73725": { desc: "Magnetic resonance angiography, lower extremit", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "74470": { desc: "Radiologic examination, renal cyst study, tran", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "74485": { desc: "Dialtion of ureter(s) or urethra, radiological", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "74742": { desc: "Transcervical catheterizaion of fallopian tube", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "75716": { desc: "Angiography, extremity, bilateral, radiologica", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "75741": { desc: "Angiography, pulmonary, unilateral, selective,", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "75746": { desc: "Angiography, pulmonary, by nonselective cathet", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "75756": { desc: "Angiography, internal mammary, radiological su", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "75801": { desc: "Lymphangiography, extremity only, unilateral, ", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "75805": { desc: "Lymphangiography, pelvic/abdominal, unilateral", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "75820": { desc: "Venography, extremity, unilateral, radiologica", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "75831": { desc: "Venography, renal, unilateral, selective, radi", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "75840": { desc: "Venography, adrenal, unilateral, selecive, rad", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "76510": { desc: "Ophthalmic ultrasound, diagnostic; B-scan and ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76511": { desc: "Ophthalmic ultrasound, diagnostic; quantitativ", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76512": { desc: "Ophthalmic ultrasound, diagnostic; B-scan (wit", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76529": { desc: "Opthalmic ultrasonic FB localization", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "76641": { desc: "Ultrasound, breast, unilateral, real time with", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "76642": { desc: "Ultrasound, breast, unilateral, real time with", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "76881": { desc: "Ultrasound, complete joint (ie, joint space an", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76882": { desc: "Ultrasound, limited, joint or focal evaluation", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76883": { desc: "Ultrasound, nerve(s) and accompanying structur", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76885": { desc: "Ultrasound, infant hips, real-time with imagin", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "76886": { desc: "Ultrasound, infant hips, real-time with imagin", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "77046": { desc: "Magnetic resonance imaging, breast, without co", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "77048": { desc: "Magnetic resonance imaging, breast, without an", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "77053": { desc: "Mammary ductogram or galactogram, single duct,", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "77054": { desc: "Mammary ductogram or galactogram, multiple duc", lateralityReq: true, allowedMods: ["RT", "LT", "50"], bilateral: "" },
  "77061": { desc: "Diagnostic digital breast tomosynthesis; unila", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
  "77065": { desc: "Diagnostic mammography, including computer-aid", lateralityReq: true, allowedMods: ["RT", "LT"], bilateral: "" },
};

// Add-On CPT Crosswalk (from the reference "Add-On CPT Crosswalk" tab)
const ADDON_CODES: Record<string, { desc: string; primaryRange: string[]; primaryRequired: boolean }> = {
  "11001": { desc: "Debridement add'l 20 sq cm", primaryRange: ["11000"], primaryRequired: true },
  "11102": { desc: "Tangential biopsy add'l lesion", primaryRange: ["11100"], primaryRequired: true },
  "11104": { desc: "Punch biopsy add'l lesion", primaryRange: ["11103"], primaryRequired: true },
  "13102": { desc: "Repair complex wound add'l 5 cm", primaryRange: ["13101"], primaryRequired: true },
  "15003": { desc: "Skin graft wound prep add'l 100 sq cm", primaryRange: ["15002"], primaryRequired: true },
  "15101": { desc: "Split thickness autograft trunk/arm/leg", primaryRange: ["15100"], primaryRequired: true },
  "15777": { desc: "Biologic implant soft tissue reinforcement", primaryRange: ["19340", "19342", "19357", "19361", "19364", "19367", "19368", "19369", "19380"], primaryRequired: true },
  "17003": { desc: "Destruction benign/premalignant lesions", primaryRange: ["17000"], primaryRequired: true },
  "22585": { desc: "Anterior interbody arthrodesis add'l interspace", primaryRange: ["22554", "22556", "22558"], primaryRequired: true },
  "22614": { desc: "Posterior/posterolateral arthrodesis add'l", primaryRange: ["22590", "22595", "22600", "22610", "22612"], primaryRequired: true },
  "22632": { desc: "Posterior interbody arthrodesis add'l interspace", primaryRange: ["22630"], primaryRequired: true },
  "22634": { desc: "Posterior/transforaminal interbody arthrodesis add'l", primaryRange: ["22633"], primaryRequired: true },
  "22840": { desc: "Posterior non-segmental instrumentation", primaryRange: ["22590", "22595", "22600", "22610", "22612", "22614", "22630", "22632", "22633", "22634", "22800", "22802", "22804", "22808", "22810", "22812"], primaryRequired: true },
  "22842": { desc: "Posterior segmental instrumentation 3-6", primaryRange: ["22590", "22595", "22600", "22610", "22612", "22614", "22630", "22632", "22633", "22634", "22800", "22802", "22804", "22808", "22810", "22812"], primaryRequired: true },
  "22843": { desc: "Posterior segmental instrumentation 7-12", primaryRange: ["22590", "22595", "22600", "22610", "22612", "22614", "22630", "22632", "22633", "22800", "22802", "22804", "22808", "22810", "22812"], primaryRequired: true },
  "22845": { desc: "Anterior instrumentation 2-3 vertebral segments", primaryRange: ["22554", "22556", "22558", "22585", "22808", "22810", "22812"], primaryRequired: true },
  "22846": { desc: "Anterior instrumentation 4-7 vertebral segments", primaryRange: ["22554", "22556", "22558", "22585", "22808", "22810", "22812"], primaryRequired: true },
  "22853": { desc: "Insertion interbody biomechanical device", primaryRange: ["22558", "22612", "22630", "22633"], primaryRequired: true },
  "33141": { desc: "Endoscopic vessel harvesting add'l vessel", primaryRange: ["33140"], primaryRequired: true },
  "33225": { desc: "Pacemaker LV lead placement add'l venous access", primaryRange: ["33206", "33207", "33208", "33212", "33213", "33214", "33221", "33224", "33227", "33228", "33229", "33230", "33231", "33233", "33234", "33235", "33240", "33249"], primaryRequired: true },
  "44015": { desc: "Tube/needle catheter jejunostomy add'l", primaryRange: ["44005", "44010", "44020", "44120", "44130", "44140", "44141", "44143", "44144", "44145", "44146", "44147", "44150", "44151", "44155", "44160"], primaryRequired: true },
  "44121": { desc: "Small intestine resection add'l segment", primaryRange: ["44120"], primaryRequired: true },
  "45392": { desc: "Colonoscopy snare polypectomy add'l lesion", primaryRange: ["45385"], primaryRequired: true },
  "61517": { desc: "Infusion pharmacological agent brain add'l", primaryRange: ["61516"], primaryRequired: true },
  "63035": { desc: "Laminotomy add'l interspace", primaryRange: ["63030", "63040", "63042", "63020"], primaryRequired: true },
  "63048": { desc: "Laminectomy add'l segment", primaryRange: ["63045", "63046", "63047"], primaryRequired: true },
  "63076": { desc: "Discectomy anterior add'l interspace, cervical", primaryRange: ["63075"], primaryRequired: true },
  "66990": { desc: "Ophthalmic endoscope add'l", primaryRange: ["66982", "66983", "66984"], primaryRequired: true },
  "69990": { desc: "Microsurgical techniques add'l", primaryRange: [], primaryRequired: true },
  "76937": { desc: "US guidance vascular access add'l", primaryRange: ["36555", "36556", "36557", "36558", "36560", "36561", "36563", "36565", "36566", "36568", "36569", "36570", "36571"], primaryRequired: true },
  "77001": { desc: "Fluoroscopic guidance central venous access add'l", primaryRange: ["36555", "36556", "36557", "36558", "36560", "36561", "36563", "36565", "36566", "36568", "36569", "36570", "36571"], primaryRequired: true },
  "77003": { desc: "Fluoroscopic guidance spinal injection add'l", primaryRange: ["62320", "62321", "62322", "62323", "64479", "64480", "64483", "64484", "64490", "64491", "64492", "64493", "64494", "64495"], primaryRequired: true },
  "77012": { desc: "CT guidance needle placement add'l", primaryRange: [], primaryRequired: true },
  "78496": { desc: "Cardiac blood pool SPECT add'l", primaryRange: ["78491"], primaryRequired: true },
  "88185": { desc: "Flow cytometry add'l marker", primaryRange: ["88184"], primaryRequired: true },
  "88314": { desc: "Special stain group II add'l", primaryRange: ["88313"], primaryRequired: true },
  "88334": { desc: "Pathology consultation intraoperative add'l", primaryRange: ["88333"], primaryRequired: true },
  "90833": { desc: "Psychotherapy add'l 30 min with E&M", primaryRange: ["99202", "99212", "99213", "99214", "99215", "99221", "99222", "99223", "99231", "99232", "99233"], primaryRequired: true },
  "90836": { desc: "Psychotherapy add'l 45 min with E&M", primaryRange: ["99202", "99212", "99213", "99214", "99215", "99221", "99222", "99223", "99231", "99232", "99233"], primaryRequired: true },
  "90838": { desc: "Psychotherapy add'l 60 min with E&M", primaryRange: ["99202", "99212", "99213", "99214", "99215", "99221", "99222", "99223", "99231", "99232", "99233"], primaryRequired: true },
  "96366": { desc: "IV infusion add'l hour", primaryRange: ["96365", "96367", "96374"], primaryRequired: true },
  "96375": { desc: "IV push new drug add'l", primaryRange: ["96365", "96374", "96409", "96413"], primaryRequired: true },
  "99100": { desc: "Anesthesia, unusual patient age", primaryRange: [], primaryRequired: true },
  "99116": { desc: "Anesthesia, utilization of hypothermia", primaryRange: [], primaryRequired: true },
  "99135": { desc: "Anesthesia, controlled hypotension", primaryRange: [], primaryRequired: true },
  "99140": { desc: "Anesthesia, emergency conditions", primaryRange: [], primaryRequired: true },
  "99153": { desc: "Moderate sedation add'l 15 min, same provider", primaryRange: ["99151", "99152"], primaryRequired: true },
  "99157": { desc: "Moderate sedation add'l 15 min, second provider", primaryRange: ["99155", "99156"], primaryRequired: true },
  "99292": { desc: "Critical care add'l 30 min", primaryRange: ["99291"], primaryRequired: true },
  "99354": { desc: "Prolonged outpatient service add'l", primaryRange: ["99205", "99215", "99245", "99483"], primaryRequired: true },
  "99356": { desc: "Prolonged inpatient/observation add'l", primaryRange: ["99223", "99233", "99236"], primaryRequired: true },
  "99417": { desc: "Prolonged outpatient visit add'l 15 min", primaryRange: ["99205", "99215"], primaryRequired: true },
  "99418": { desc: "Prolonged inpatient/observation add'l 15 min", primaryRange: ["99223", "99233", "99236"], primaryRequired: true },
  "0164T": { desc: "Total disc arthroplasty add'l interspace", primaryRange: ["22857"], primaryRequired: true },
  "64480": { desc: "Transforaminal epidural injection add'l, cervical", primaryRange: ["64479"], primaryRequired: true },
  "64484": { desc: "Transforaminal epidural injection add'l, lumbar", primaryRange: ["64483"], primaryRequired: true },
  "64491": { desc: "Paravertebral facet injection add'l, cervical 2nd", primaryRange: ["64490"], primaryRequired: true },
  "64492": { desc: "Paravertebral facet injection add'l, cervical 3rd", primaryRange: ["64490", "64491"], primaryRequired: true },
  "64494": { desc: "Paravertebral facet injection add'l, lumbar 2nd", primaryRange: ["64493"], primaryRequired: true },
  "64495": { desc: "Paravertebral facet injection add'l, lumbar 3rd", primaryRange: ["64493", "64494"], primaryRequired: true },
};

// Keywords for various categories
const DME_KEYWORDS = [
  "wheelchair", "walker", "crutch", "brace", "prosthetic", "orthotic",
  "cpap", "bipap", "oxygen", "nebulizer", "commode", "cane", "bed",
  "mattress", "trapeze", "traction", "splint", "collar", "boot",
];

const BLOOD_KEYWORDS = [
  "whole blood", "packed red", "red blood cell", "rbc", "platelet",
  "plasma", "cryoprecipitate", "cryo", "fresh frozen", "ffp",
  "blood product", "transfusion", "blood component",
];

const IMPLANT_KEYWORDS = [
  "implant", "prosthesis", "prosthetic", "pacemaker", "defibrillator",
  "stent", "graft", "fixation", "screw", "plate", "rod", "cage",
  "mesh", "valve", "spacer", "anchor", "coil", "catheter implant",
  "neurostimulator", "cochlear", "lens implant", "joint replacement",
];

const NON_BILLABLE_KEYWORDS = [
  "convenience", "comfort item", "personal item", "telephone",
  "tv rental", "television", "guest meal", "guest tray",
  "take home", "take-home", "hygiene kit", "amenity",
  "cosmetic", "non-covered", "noncovered", "gown", "slipper", "robe",
  "self-care", "elective non-covered",
];

// Modifiers that should NEVER be hard-coded in CDM (from the reference call notes)
const NEVER_HARDCODE_MODS = ["59", "XE", "XS", "XP", "XU", "25", "76", "77"];

// Revenue code to CPT range mapping
const REV_CODE_CPT_RANGES: Record<string, { min: number; max: number; alpha?: string[] }[]> = {
  "025": [{ min: 0, max: 0, alpha: ["J", "A", "C", "Q"] }],
  "026": [{ min: 96360, max: 96379 }],
  "030": [{ min: 80000, max: 89999 }],
  "031": [{ min: 80000, max: 89999 }],
  "032": [{ min: 70000, max: 76999 }],
  "033": [{ min: 77000, max: 77999 }],
  "034": [{ min: 78000, max: 79999 }],
  "035": [{ min: 70000, max: 76999 }],
  "036": [{ min: 10000, max: 69999 }],
  "037": [{ min: 100, max: 1999 }],
  "041": [{ min: 94000, max: 94999 }],
  "042": [{ min: 97000, max: 97999 }],
  "043": [{ min: 97000, max: 97999 }],
  "044": [{ min: 92500, max: 92700 }],
  "045": [{ min: 99281, max: 99285 }],
  "048": [{ min: 93000, max: 93999 }],
  "051": [{ min: 99201, max: 99499 }],
  "073": [{ min: 93000, max: 93042 }],
  "075": [{ min: 43200, max: 45398 }],
};

// ─── Rule Engine ─────────────────────────────────────────────

export function runRules(items: any[]): RuleResult[] {
  const results: RuleResult[] = [];

  // Pre-compute groupings
  const codeGroups = new Map<string, any[]>();
  const allCodeSet = new Set<string>(); // all CPT codes in CDM

  for (const item of items) {
    const code = item.hcpcs_cpt_code?.trim();
    const rev = item.revenue_code?.trim();
    const price = parseFloat(item.gross_charge) || 0;

    if (code) allCodeSet.add(code);
    if (code && rev) {
      const key = `${code}|${rev}`;
      if (!codeGroups.has(key)) codeGroups.set(key, []);
      codeGroups.get(key)!.push(item);
    }
  }

  const flaggedDupes = new Set<string>();

  for (const item of items) {
    const desc = (item.charge_description || "").toLowerCase();
    const code = (item.hcpcs_cpt_code || "").trim();
    const rev = (item.revenue_code || "").trim();
    // Normalize to a 4-digit UB-04 revenue code first (CDMs often drop the
    // leading zero, e.g. "270" for 0270, "352" for 0352), then take the 3-digit
    // family prefix — otherwise the rev-code family checks silently miss.
    const revDigits = rev.replace(/\D/g, "");
    const rev4 = revDigits ? (revDigits.length >= 4 ? revDigits.slice(0, 4) : revDigits.padStart(4, "0")) : "";
    const rev3 = rev4.substring(0, 3);
    const price = parseFloat(item.gross_charge) || 0;
    const mod1 = (item.modifier_1 || "").trim().toUpperCase();
    const mod2 = (item.modifier_2 || "").trim().toUpperCase();
    const mod3 = (item.modifier_3 || "").trim().toUpperCase();
    const allMods = [mod1, mod2, mod3].filter(Boolean);
    const procNum = item.procedure_number || item.id;

    // ─── Rule S.2: No Revenue Code ─────────────────────
    if (!rev) {
      results.push({
        rule_id: "S.2", charge_item_id: item.id,
        title: `No revenue code assigned - ${procNum}`,
        description: `Charge item "${item.charge_description}" (${procNum}) has no revenue code. Cannot bill on UB-04 without a revenue code.`,
        severity: "critical", category: "Missing Code",
        recommendation: "Assign the appropriate UB-04 revenue code based on the department and service type.",
      });
    }

    // ─── Rule S.4: Missing CPT/HCPCS ───────────────────
    if (!code && rev) {
      const requiresHcpcs = REV_CODES_REQUIRING_HCPCS.some((r) => rev3 === r || rev4.startsWith(r));
      // Rev 0637 = "self-administered drugs." These are legitimately billed WITHOUT
      // a HCPCS (they're non-covered/packaged self-admin meds, caught by the Rev-637
      // self-admin rule instead), so they must NOT be flagged as missing-HCPCS. Rev
      // 0636 (drugs requiring detailed coding) still requires a HCPCS and is kept.
      const isSelfAdminDrug = rev4 === "0637";
      // Supply/implant lines (rev 027x) are their own reported category so the
      // "Supply: 0% HCPCS coverage" pattern is visible separately from generic
      // missing-code lines.
      const isSupply = rev3 === "027";
      if (requiresHcpcs && !isSelfAdminDrug) {
        results.push({
          rule_id: "S.4", charge_item_id: item.id,
          title: isSupply
            ? `Supply line missing HCPCS (rev ${rev}) - ${procNum}`
            : `Revenue code ${rev} requires HCPCS - none assigned - ${procNum}`,
          description: isSupply
            ? `Supply/implant line "${item.charge_description}" is under revenue code ${rev} with no HCPCS. Supplies billed without a HCPCS are non-covered/packaged, so the charge isn't separately reimbursed.`
            : `Charge item "${item.charge_description}" uses revenue code ${rev} which requires a CPT/HCPCS code on outpatient claims, but none is assigned.`,
          severity: "high", category: isSupply ? "Supply - Missing HCPCS" : "Missing Code",
          recommendation: isSupply
            ? "Assign the appropriate HCPCS (and C-code for devices) so the supply is billable, or confirm it is intentionally packaged."
            : "Assign the appropriate CPT/HCPCS code for this service. Claims submitted without the required HCPCS will be denied.",
        });
      }
    }

    // ─── Rule S.3: Vague/Missing Description ───────────
    if (!desc || desc.length < 3 || ["misc", "other", "supply", "charge", "fee", "item"].includes(desc.trim())) {
      results.push({
        rule_id: "S.3", charge_item_id: item.id,
        title: `Vague or missing description - ${procNum}`,
        description: `Charge item ${procNum} has description "${item.charge_description || "(blank)"}" which is too vague to identify the service.`,
        severity: "medium", category: "Description",
        recommendation: "Update the charge description to clearly identify the service, supply, or procedure.",
      });
    }

    // ─── Rule 6.5: Zero/Null Price (three-category framework) ──
    // A $0 price is only a problem for some lines. Exclude the categories the
    // reference method treats as correctly $0: global-surgery follow-up (99024),
    // unlisted/NOS codes (x9999, priced at time of service), and any SI=B
    // (always bundled). Everything else with active use is a real pricing gap.
    if (price <= 0 && item.is_active !== false) {
      const cn = normalizeHcpcs(code);
      const si = getReference(cn)?.si;
      const isNOS = /^\d{5}$/.test(cn) && cn.endsWith("9999");
      const expectedZero = cn === "99024" || isNOS || si === "B";
      if (!expectedZero) {
        results.push({
          rule_id: "6.5", charge_item_id: item.id,
          title: `Zero or missing price - ${procNum} (${code || "no code"})`,
          description: `Active charge item "${item.charge_description}" has a price of $${price.toFixed(2)}. (Excludes global-surgery 99024, unlisted x9999, and SI=B lines, which are correctly $0.)`,
          severity: "high", category: "Pricing - Missing",
          recommendation: "Set an appropriate charge amount or deactivate this line item if no longer in use.",
        });
      }
    }

    // ─── Rule 1.7: DME Keyword Check ───────────────────
    if (DME_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (rev3 !== "027" && rev !== "0274") {
        results.push({
          rule_id: "1.7", charge_item_id: item.id,
          title: `DME item may need revenue code 0274 - ${procNum}`,
          description: `"${item.charge_description}" appears to be a DME item but uses revenue code ${rev} instead of 0274.`,
          severity: "medium", category: "Revenue Code",
          recommendation: "Review if this item should use revenue code 0274 and an appropriate HCPCS L-code or A/E/K code.",
        });
      }
    }

    // ─── Rule 1.8: Blood Product Check ─────────────────
    if (BLOOD_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (!rev.startsWith("038") && !rev.startsWith("039")) {
        results.push({
          rule_id: "1.8", charge_item_id: item.id,
          title: `Blood product may need 038X revenue code - ${procNum}`,
          description: `"${item.charge_description}" appears to be a blood product but uses revenue code ${rev}.`,
          severity: "high", category: "Revenue Code",
          recommendation: "Assign the appropriate 038X revenue code (0380-0389) for blood and blood component charges.",
        });
      }
    }

    // ─── Rule 1.9: Implant Check ───────────────────────
    if (IMPLANT_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (!["0275", "0276", "0278"].includes(rev) && !rev.startsWith("027")) {
        results.push({
          rule_id: "1.9", charge_item_id: item.id,
          title: `Implant may need implant revenue code - ${procNum}`,
          description: `"${item.charge_description}" appears to be an implant but uses revenue code ${rev}.`,
          severity: "medium", category: "Revenue Code",
          recommendation: "Review if this item should use an implant-specific revenue code (0275 Pacemaker, 0276 Intraocular Lens, 0278 Other Implants).",
        });
      }
    }

    // ─── Rule 2.1: Non-Billable Keywords ───────────────
    if (NON_BILLABLE_KEYWORDS.some((kw) => desc.includes(kw))) {
      results.push({
        rule_id: "2.1", charge_item_id: item.id,
        title: `Possible non-billable item - ${procNum}`,
        description: `"${item.charge_description}" contains keywords suggesting this may be a convenience or non-billable item.`,
        severity: "critical", category: "Compliance",
        recommendation: "Verify this item is billable to Medicare/payers. If it is a patient convenience item, ensure it is excluded from payer billing.",
      });
    }

    // ─── Rule 2.4: Hard-Coded Modifiers (expanded) ─────
    const badMods = allMods.filter((m) => NEVER_HARDCODE_MODS.includes(m));
    if (badMods.length > 0) {
      results.push({
        rule_id: "2.4", charge_item_id: item.id,
        title: `Modifier ${badMods.join("/")} should not be hard-coded - ${procNum}`,
        description: `"${item.charge_description}" has modifier ${badMods.join("/")} hard-coded in the CDM. These are situational modifiers that should only be applied at the claim level.`,
        severity: "high", category: "Modifier - Compliance Risk",
        recommendation: `Remove hard-coded modifier ${badMods.join("/")} from the CDM. These modifiers should be applied during claim submission when clinically appropriate.`,
      });
    }

    // ─── Rule R1: Radiology Missing Laterality (the reference Radiology QA) ──
    if (code && RADIOLOGY_LATERALITY[code]) {
      const radInfo = RADIOLOGY_LATERALITY[code];
      if (radInfo.lateralityReq) {
        const hasLaterality = allMods.some((m) => ["LT", "RT", "50"].includes(m));
        if (!hasLaterality) {
          results.push({
            rule_id: "R1", charge_item_id: item.id,
            title: `Missing laterality modifier for ${code} - ${procNum}`,
            description: `"${item.charge_description}" (${radInfo.desc}) requires LT/RT modifier but none is assigned. This causes claim denials and lost revenue.`,
            severity: "high", category: "Radiology - Missing Modifier",
            recommendation: `Split CDM line into two entries with LT and RT modifiers, or enforce modifier at charge entry. Bilateral billing method: ${radInfo.bilateral}.`,
          });
        }
      } else {
        // Flag codes that should NOT have laterality but do
        const hasLaterality = allMods.some((m) => ["LT", "RT"].includes(m));
        if (hasLaterality) {
          results.push({
            rule_id: "R4", charge_item_id: item.id,
            title: `Laterality modifier used on non-lateral code ${code} - ${procNum}`,
            description: `"${item.charge_description}" (${radInfo.desc}) has LT/RT modifier but this code is not a laterality code. This may cause claim errors.`,
            severity: "medium", category: "Radiology - Incorrect Modifier",
            recommendation: "Remove LT/RT modifier from this CDM line. This code does not require laterality.",
          });
        }
      }
    }

    // ─── Rule A1: Add-On Code Without Primary (the reference Add-On QA) ──
    if (code && ADDON_CODES[code]) {
      const addon = ADDON_CODES[code];
      if (addon.primaryRequired) {
        // Check if any primary code exists in the CDM
        let hasPrimary = false;
        if (addon.primaryRange.length > 0) {
          hasPrimary = addon.primaryRange.some((p) => allCodeSet.has(p));
        } else if (code === "77012") {
          // CT guidance: primary is any surgical code 10000-69990
          hasPrimary = [...allCodeSet].some((c) => {
            const n = parseInt(c);
            return !isNaN(n) && n >= 10000 && n <= 69990;
          });
        }
        if (!hasPrimary) {
          results.push({
            rule_id: "A1", charge_item_id: item.id,
            title: `Add-on code ${code} without primary code in CDM - ${procNum}`,
            description: `"${item.charge_description}" (${addon.desc}) is an add-on code that requires a primary procedure code (${addon.primaryRange.join(", ") || "surgical range"}) but none was found in the CDM.`,
            severity: "high", category: "Add-On - Missing Primary",
            recommendation: `Ensure the primary procedure code is built in the CDM. Add-on codes cannot be billed without their corresponding primary code. Required primary: ${addon.primaryRange.join(", ") || "10000-69990"}.`,
          });
        }
      }
    }

    // ─── Rule L1: Lab Panel + Components Billed (the reference Lab QA) ──
    if (code && LAB_PANELS[code]) {
      const panel = LAB_PANELS[code];
      // Check if any component codes also exist as separate CDM items
      const componentsInCDM = panel.components.filter((c) => allCodeSet.has(c));
      if (componentsInCDM.length > 0) {
        results.push({
          rule_id: "L1", charge_item_id: item.id,
          title: `Panel ${code} and components both in CDM - ${procNum}`,
          description: `"${panel.name}" (${code}) is in the CDM along with ${componentsInCDM.length} of its component codes (${componentsInCDM.slice(0, 5).join(", ")}${componentsInCDM.length > 5 ? "..." : ""}). If both panel and components are billed on the same claim, this creates an NCCI bundling risk.`,
          severity: "high", category: "Lab - Panel/Component Bundling",
          recommendation: "Verify CDM build ensures panel and individual components cannot be billed together on the same claim. Dual build (panel + individual) is acceptable only if claim logic prevents overlap.",
        });
      }
    }

    // ─── Rule L2: All Panel Components Present But Panel Missing ──
    // (Run once per panel, not per item - check after loop)

    // ─── Rule 1.3: Revenue Code / CPT Range Mismatch ──
    if (code && rev3 && REV_CODE_CPT_RANGES[rev3]) {
      const ranges = REV_CODE_CPT_RANGES[rev3];
      const codeNum = parseInt(code);
      const isAlpha = /^[A-Z]/.test(code);

      let matched = false;
      for (const range of ranges) {
        if (range.alpha && isAlpha) {
          if (range.alpha.some((prefix) => code.startsWith(prefix))) {
            matched = true;
            break;
          }
        } else if (!isAlpha && !isNaN(codeNum)) {
          if (codeNum >= range.min && codeNum <= range.max) {
            matched = true;
            break;
          }
        }
      }

      if (!matched && !isAlpha && !isNaN(codeNum)) {
        results.push({
          rule_id: "1.3", charge_item_id: item.id,
          title: `Revenue code ${rev} may not match CPT ${code} - ${procNum}`,
          description: `"${item.charge_description}" uses revenue code ${rev} with CPT ${code}. The CPT code falls outside the expected range for this revenue code family.`,
          severity: "high", category: "Revenue Code Mismatch",
          recommendation: "Verify the revenue code and CPT code are correctly paired. Mismatches cause claim denials.",
        });
      }
    }

    // ─── Rule 1.11: Duplicate Check ────────────────────
    if (code && rev) {
      const dupeKey = `${code}|${rev}|${price.toFixed(2)}`;
      const group = codeGroups.get(`${code}|${rev}`);
      if (group && group.length > 1 && !flaggedDupes.has(dupeKey)) {
        const samePrice = group.filter(
          (g) => (parseFloat(g.gross_charge) || 0).toFixed(2) === price.toFixed(2)
        );
        if (samePrice.length > 1) {
          flaggedDupes.add(dupeKey);
          results.push({
            rule_id: "1.11", charge_item_id: item.id,
            title: `Potential duplicate - ${code} / Rev ${rev} / $${price.toFixed(2)}`,
            description: `Found ${samePrice.length} charge items with the same HCPCS ${code}, revenue code ${rev}, and price $${price.toFixed(2)}.`,
            severity: "medium", category: "Duplicate",
            recommendation: `Review the ${samePrice.length} items sharing code ${code}, rev ${rev}, price $${price.toFixed(2)}. Remove duplicates if they represent the same service.`,
          });
        }
      }

      // Rule 3.2: Same code, different prices
      if (group && group.length > 1) {
        const prices = group.map((g) => parseFloat(g.gross_charge) || 0).filter((p) => p > 0);
        if (prices.length > 1) {
          const minP = Math.min(...prices);
          const maxP = Math.max(...prices);
          if (minP > 0 && maxP / minP > 3.0) {
            const varKey = `3.2|${code}|${rev}`;
            if (!flaggedDupes.has(varKey)) {
              flaggedDupes.add(varKey);
              results.push({
                rule_id: "3.2", charge_item_id: item.id,
                title: `Price variance for ${code} - $${minP.toFixed(2)} to $${maxP.toFixed(2)}`,
                description: `Code ${code} with revenue code ${rev} has ${group.length} entries with prices ranging from $${minP.toFixed(2)} to $${maxP.toFixed(2)} (${((maxP / minP - 1) * 100).toFixed(0)}% variance).`,
                severity: "low", category: "Pricing Consistency",
                // A price SPREAD is a consistency defect, not a bankable dollar
                // opportunity — keep it out of financial_impact so it doesn't inflate totals.
                financial_impact: undefined,
                recommendation: "Review whether different prices for the same code are intentional (e.g., different units) or a data error.",
              });
            }
          }
        }
      }
    }

    // ─── Rule 3.3: Unlisted Code Check ─────────────────
    if (code && /^\d{5}$/.test(code) && code.endsWith("99")) {
      results.push({
        rule_id: "3.3", charge_item_id: item.id,
        title: `Unlisted code ${code} - review for specific alternative - ${procNum}`,
        description: `"${item.charge_description}" uses code ${code} which appears to be an unlisted/unspecified procedure code.`,
        severity: "medium", category: "Coding Opportunity",
        recommendation: "Review if a specific CPT/HCPCS code exists for this service. Unlisted codes require additional documentation and may delay reimbursement.",
      });
    }
  }

  // ─── Rule L2: Panel Missing But All Components Present ──
  for (const [panelCode, panel] of Object.entries(LAB_PANELS)) {
    if (!allCodeSet.has(panelCode)) {
      const componentsPresent = panel.components.filter((c) => allCodeSet.has(c));
      if (panel.allRequired && componentsPresent.length === panel.components.length) {
        results.push({
          rule_id: "L2", charge_item_id: items[0]?.id || "",
          title: `All components for ${panel.name} (${panelCode}) present but panel not built`,
          description: `All ${panel.components.length} required components for ${panel.name} are in the CDM (${componentsPresent.join(", ")}), but the panel code ${panelCode} is not built. This is a revenue leakage opportunity.`,
          severity: "high", category: "Lab - Revenue Leakage",
          recommendation: `Add panel CPT ${panelCode} (${panel.name}) to the CDM. Billing the panel instead of individual components maximizes reimbursement.`,
        });
      }
    }
  }

  return results;
}
