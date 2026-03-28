import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { calcAge } from '../../../lib/utils'

interface Props {
  patientName:      string
  patientDob:       string | null
  patientGender:    string | null
  doctorName:       string
  specialty:        string | null
  regNumber:        string | null
  clinicName:       string
  clinicAddress:    string | null
  clinicPhone:      string | null
  referToSpecialty: string
  chiefComplaint:   string
  clinicalNotes:    string
  icd10Codes:       string[]
  urgency:          'routine' | 'urgent' | 'emergency'
  date:             string
}

const URGENCY_COLOR: Record<string, string> = {
  routine:   '#006a6a',
  urgent:    '#9a3412',
  emergency: '#991b1b',
}

const URGENCY_LABEL: Record<string, string> = {
  routine:   'ROUTINE',
  urgent:    'URGENT',
  emergency: 'EMERGENCY',
}

const s = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 10, padding: 40, color: '#2a3437' },
  header:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#d9e4e8' },
  clinicName:  { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#006a6a' },
  clinicMeta:  { fontSize: 8, color: '#566164', marginTop: 2 },
  doctorBlock: { textAlign: 'right' },
  doctorName:  { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#2a3437' },
  doctorMeta:  { fontSize: 8, color: '#566164', marginTop: 2 },
  title:       { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#2a3437', marginBottom: 4 },
  urgencyBadge:{ fontSize: 9, fontFamily: 'Helvetica-Bold', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: 'flex-start', marginBottom: 14 },
  section:     { marginBottom: 12 },
  label:       { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#566164', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  patientBox:  { flexDirection: 'row', padding: 10, backgroundColor: '#f0f9ff', borderRadius: 6 },
  patientName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#2a3437' },
  patientMeta: { fontSize: 9, color: '#566164', marginTop: 2 },
  bodyText:    { fontSize: 10, color: '#2a3437', lineHeight: 1.6, padding: 8, backgroundColor: '#f8fafb', borderRadius: 6 },
  toBox:       { padding: 10, backgroundColor: '#e0f4f4', borderRadius: 6 },
  toLabel:     { fontSize: 9, color: '#566164' },
  toValue:     { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#006a6a', marginTop: 2 },
  codesRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  codeChip:    { fontSize: 9, fontFamily: 'Helvetica-Bold', paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#e0f4f4', borderRadius: 4, color: '#006a6a' },
  sig:         { marginTop: 24, alignItems: 'flex-end' },
  sigLine:     { width: 140, borderBottomWidth: 1, borderBottomColor: '#2a3437', marginBottom: 4 },
  sigLabel:    { fontSize: 8, color: '#566164' },
  footer:      { position: 'absolute', bottom: 30, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#d9e4e8', paddingTop: 8 },
  footerText:  { fontSize: 8, color: '#a9b4b7' },
})

export function ReferralPDF({
  patientName, patientDob, patientGender,
  doctorName, specialty, regNumber,
  clinicName, clinicAddress, clinicPhone,
  referToSpecialty, chiefComplaint, clinicalNotes,
  icd10Codes, urgency, date,
}: Props) {
  const age = calcAge(patientDob)

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Clinic + doctor header */}
        <View style={s.header}>
          <View>
            <Text style={s.clinicName}>{clinicName}</Text>
            {clinicAddress && <Text style={s.clinicMeta}>{clinicAddress}</Text>}
            {clinicPhone  && <Text style={s.clinicMeta}>Tel: {clinicPhone}</Text>}
          </View>
          <View style={s.doctorBlock}>
            <Text style={s.doctorName}>Dr. {doctorName}</Text>
            {specialty  && <Text style={s.doctorMeta}>{specialty}</Text>}
            {regNumber  && <Text style={s.doctorMeta}>Reg. No: {regNumber}</Text>}
            <Text style={s.doctorMeta}>Date: {date}</Text>
          </View>
        </View>

        {/* Title + urgency */}
        <Text style={s.title}>Referral Letter</Text>
        <Text style={[s.urgencyBadge, { color: '#ffffff', backgroundColor: URGENCY_COLOR[urgency] ?? '#006a6a' }]}>
          {URGENCY_LABEL[urgency] ?? urgency.toUpperCase()}
        </Text>

        {/* Referred to */}
        <View style={[s.section, { marginBottom: 16 }]}>
          <View style={s.toBox}>
            <Text style={s.toLabel}>Referred to</Text>
            <Text style={s.toValue}>{referToSpecialty}</Text>
          </View>
        </View>

        {/* Patient */}
        <View style={s.section}>
          <Text style={s.label}>Patient</Text>
          <View style={s.patientBox}>
            <View>
              <Text style={s.patientName}>{patientName}</Text>
              <Text style={s.patientMeta}>
                {age != null ? `${age} yrs` : ''}
                {age != null && patientGender ? ' · ' : ''}
                {patientGender === 'male' ? 'Male' : patientGender === 'female' ? 'Female' : patientGender ?? ''}
              </Text>
            </View>
          </View>
        </View>

        {/* Reason for referral */}
        {chiefComplaint && (
          <View style={s.section}>
            <Text style={s.label}>Reason for Referral</Text>
            <Text style={s.bodyText}>{chiefComplaint}</Text>
          </View>
        )}

        {/* Clinical summary */}
        {clinicalNotes && (
          <View style={s.section}>
            <Text style={s.label}>Clinical Summary</Text>
            <Text style={s.bodyText}>{clinicalNotes}</Text>
          </View>
        )}

        {/* ICD-10 codes */}
        {icd10Codes.length > 0 && (
          <View style={s.section}>
            <Text style={s.label}>Diagnosis Codes (ICD-10)</Text>
            <View style={s.codesRow}>
              {icd10Codes.map((code) => (
                <Text key={code} style={s.codeChip}>{code}</Text>
              ))}
            </View>
          </View>
        )}

        {/* Signature */}
        <View style={s.sig}>
          <View style={s.sigLine} />
          <Text style={s.sigLabel}>Dr. {doctorName}</Text>
          {specialty  && <Text style={s.sigLabel}>{specialty}</Text>}
          {regNumber  && <Text style={s.sigLabel}>Reg. No: {regNumber}</Text>}
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generated by ClinicFlow</Text>
          <Text style={s.footerText}>{clinicName} · {date}</Text>
        </View>

      </Page>
    </Document>
  )
}
