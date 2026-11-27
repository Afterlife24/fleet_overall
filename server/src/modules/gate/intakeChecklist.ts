/**
 * Return-intake (PHI, REF-02) checklist. Checklists stay versioned code: the item keys and labels are copied from
 * src/features/inspections/PHIInspectionDialog.tsx. The frontend defines no critical/required flags, so they are set
 * here: every static (section 1) and function (section 2) item is required; safety-relevant items are also critical.
 * Section 3 (maintenance and appearance) items are neither required nor critical.
 * A new checklist is a new version string; existing inspections keep the version and snapshots they were created with.
 */
export const RETURN_INTAKE_VERSION = 'return-intake-v1';
export const RETURN_INTAKE_TYPE = 'Return Intake';

export interface ChecklistItemDef {
  key: string;
  section: string;
  question: string;
  critical: boolean;
  required: boolean;
}

const S1 = 'Static Inspection';
const S2 = 'Function Set';
const S3 = 'Maintenance & Appearance';

const item = (key: string, section: string, question: string, critical: boolean, required: boolean): ChecklistItemDef => ({
  key, section, question, critical, required,
});

export const RETURN_INTAKE_CHECKLIST: readonly ChecklistItemDef[] = [
  item('s1_1', S1, 'Tyres and wheels', false, true),
  item('s1_2', S1, 'Steering', true, true),
  item('s1_3', S1, 'Chassis', true, true),
  item('s1_4', S1, 'Outriggers and ground plates', false, true),
  item('s1_5', S1, 'Turntable bearing and rotator', true, true),
  item('s1_6', S1, 'Torque hubs, brakes and motors', true, true),
  item('s1_7', S1, 'Mast, scissors, booms and pivoting points', true, true),
  item('s1_8', S1, 'Power tracks', false, true),
  item('s1_9', S1, 'Hydraulic cylinders and components', true, true),
  item('s1_10', S1, 'Hydraulic hoses', true, true),
  item('s1_11', S1, 'Electric cables and connectors', false, true),
  item('s1_12', S1, 'Platform', false, true),
  item('s1_13', S1, 'Rails / gates / drop bar', true, true),
  item('s1_16', S1, 'Alarms, beacons and lights', false, true),
  item('s1_17', S1, 'Batteries and battery charger', false, true),
  item('s1_18', S1, 'Engine and fluid levels', false, true),
  item('s1_19', S1, 'Hydraulic oil level and leaks', false, true),
  item('s2_1', S2, 'Test function level sensor', false, true),
  item('s2_2', S2, 'Test all limit switches / security systems', true, true),
  item('s2_3', S2, 'Test functions lower controls', false, true),
  item('s2_4', S2, 'Test emergency descent', true, true),
  item('s2_5', S2, 'Test generator', false, true),
  item('s2_6', S2, 'Test functions upper controls', false, true),
  item('s2_7', S2, 'Test functions accessories', false, true),
  item('s2_8', S2, 'Stabilisers function down / up', false, true),
  item('s2_9', S2, 'Drive interlock off / on', true, true),
  item('s3_1', S3, 'Cleaning', false, false),
  item('s3_2', S3, 'Lubrication', false, false),
  item('s3_3', S3, 'Test certificate and manual', false, false),
  item('s3_4', S3, 'Succeed maintenance planning', false, false),
  item('s3_5', S3, 'Fill up fuel / charge battery', false, false),
];
