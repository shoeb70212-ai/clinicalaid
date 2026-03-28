import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { PrescriptionItem } from '../../../types'
import { calcAge } from '../../../lib/utils'
import { TIMING_LABEL } from '../../../lib/constants'

interface Props {
  patientName:    string
  patientDob:     string | null
  patientGender:  string | null
  doctorName:     string
  specialty:      string | null
  regNumber:      string | null
  clinicName:     string
  clinicAddress:  string | null
  clinicPhone:    string | null
  chiefComplaint: string
  prescriptions:  PrescriptionItem[]
  date:           string
}


const s = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 10, padding: 40, color: '#2a3437' },
  header:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#d9e4e8' },
  clinicName:  { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#006a6a' },
  clinicMeta:  { fontSize: 8, color: '#566164', marginTop: 2 },
  doctorBlock: { textAlign: 'right' },
  doctorName:  { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#2a3437' },
  doctorMeta:  { fontSize: 8, color: '#566164', marginTop: 2 },
  section:     { marginBottom: 14 },
  label:       { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#566164', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  patientBox:  { flexDirection: 'row', gap: 20, padding: 10, backgroundColor: '#f0f9ff', borderRadius: 6 },
  patientName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#2a3437' },
  patientMeta: { fontSize: 9, color: '#566164', marginTop: 2 },
  complaint:   { fontSize: 10, color: '#2a3437', padding: 8, backgroundColor: '#f8fafb', borderRadius: 6, lineHeight: 1.5 },
  rxHeader:    { flexDirection: 'row', backgroundColor: '#006a6a', padding: '6 10', borderRadius: '6 6 0 0' },
  rxColName:   { flex: 2, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#fff' },
  rxColSmall:  { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#fff' },
  rxRow:       { flexDirection: 'row', padding: '6 10', borderBottomWidth: 1, borderBottomColor: '#e8eff1' },
  rxRowAlt:    { flexDirection: 'row', padding: '6 10', backgroundColor: '#f8fafb', borderBottomWidth: 1, borderBottomColor: '#e8eff1' },
  rxCellName:  { flex: 2, fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#2a3437' },
  rxCellSub:   { fontSize: 7.5, color: '#566164', marginTop: 1 },
  rxCellSmall: { flex: 1, fontSize: 9, color: '#2a3437' },
  footer:      { position: 'absolute', bottom: 30, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#d9e4e8', paddingTop: 8 },
  footerText:  { fontSize: 8, color: '#a9b4b7' },
  sig:         { marginTop: 30, alignItems: 'flex-end' },
  sigLine:     { width: 140, borderBottomWidth: 1, borderBottomColor: '#2a3437', marginBottom: 4 },
  sigLabel:    { fontSize: 8, color: '#566164' },
})

export function PrescriptionPDF({
  patientName, patientDob, patientGender,
  doctorName, specialty, regNumber,
  clinicName, clinicAddress, clinicPhone,
  chiefComplaint, prescriptions, date,
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

        {/* Patient info */}
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

        {/* Chief complaint */}
        {chiefComplaint && (
          <View style={s.section}>
            <Text style={s.label}>Chief Complaint</Text>
            <Text style={s.complaint}>{chiefComplaint}</Text>
          </View>
        )}

        {/* Prescription table */}
        {prescriptions.length > 0 && (
          <View style={s.section}>
            <Text style={s.label}>℞  Prescription</Text>
            <View style={s.rxHeader}>
              <Text style={s.rxColName}>Drug</Text>
              <Text style={s.rxColSmall}>Dosage</Text>
              <Text style={s.rxColSmall}>Duration</Text>
              <Text style={s.rxColSmall}>Timing</Text>
            </View>
            {prescriptions.map((item, idx) => (
              <View key={idx} style={idx % 2 === 0 ? s.rxRow : s.rxRowAlt}>
                <View style={{ flex: 2 }}>
                  <Text style={s.rxCellName}>{item.drug_name}</Text>
                  {item.generic_name && <Text style={s.rxCellSub}>{item.generic_name}</Text>}
                </View>
                <Text style={s.rxCellSmall}>{item.dosage}</Text>
                <Text style={s.rxCellSmall}>{item.duration_days} days</Text>
                <Text style={s.rxCellSmall}>{item.timing ? (TIMING_LABEL[item.timing] ?? item.timing) : '—'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Signature */}
        <View style={s.sig}>
          <View style={s.sigLine} />
          <Text style={s.sigLabel}>Dr. {doctorName}</Text>
          {regNumber && <Text style={s.sigLabel}>Reg. No: {regNumber}</Text>}
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
