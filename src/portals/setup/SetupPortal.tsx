import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { StepAccount }    from './steps/StepAccount'
import { StepClinic }     from './steps/StepClinic'
import { StepMode }       from './steps/StepMode'
import { StepQR }         from './steps/StepQR'
import { StepInvite }     from './steps/StepInvite'
import { StepDone }       from './steps/StepDone'
import type { ClinicMode } from '../../types'
import { supabase } from '../../lib/supabase'

export type SetupData = {
  // Step 1
  doctorName:    string
  email:         string
  password:      string
  mobile:        string
  regNumber:     string
  qualification: string
  specialty:     string
  // Step 2
  clinicName:    string
  address:       string
  phone:         string
  state:         string
  pinCode:       string
  primaryColor:  string
  logoFile:      File | null
  // Step 3
  clinicMode:    ClinicMode
  // Internal
  clinicId:      string
  staffId:       string
  sessionId:     string
}

const STEPS = ['account', 'clinic', 'mode', 'qr_or_invite', 'done'] as const
type Step = typeof STEPS[number]

export default function SetupPortal() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('account')
  const [data, setData] = useState<Partial<SetupData>>({
    primaryColor: '#0891b2',
    clinicMode:   'solo',
    logoFile:     null,
  })

  // If user arrived via Google OAuth, they already have a session.
  // Skip StepAccount and use their existing auth user ID.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const name = session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? ''
        setData((prev) => ({
          ...prev,
          staffId:    session.user.id,
          email:      session.user.email ?? '',
          doctorName: name,
        }))
        // Only skip account step if they came via OAuth (no password)
        const isOAuth = session.user.app_metadata?.provider !== 'email'
        if (isOAuth) setStep('clinic')
      }
    })
  }, [])

  const update = (patch: Partial<SetupData>) =>
    setData((prev) => ({ ...prev, ...patch }))

  const next = () => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  const goToApp = () => {
    if (data.clinicMode === 'solo') navigate('/doctor')
    else navigate('/reception')
  }

  return (
    <main id="main-content" className="min-h-screen bg-[#ecfeff] p-4 md:p-8">
      <div className="mx-auto max-w-lg">
        {/* Progress indicator */}
        <div className="mb-8 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
                STEPS.indexOf(step) >= i ? 'bg-[#0891b2]' : 'bg-[#0891b2]/20'
              }`}
            />
          ))}
        </div>

        {step === 'account'        && <StepAccount data={data} update={update} onNext={next} />}
        {step === 'clinic'         && <StepClinic  data={data} update={update} onNext={next} />}
        {step === 'mode'           && <StepMode    data={data} update={update} onNext={next} />}
        {step === 'qr_or_invite'   && (
          data.clinicMode === 'solo'
            ? <StepQR     data={data} onNext={next} />
            : <StepInvite data={data} onNext={next} />
        )}
        {step === 'done' && <StepDone onEnterApp={goToApp} />}
      </div>
    </main>
  )
}
