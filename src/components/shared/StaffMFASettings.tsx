import { useState, useEffect } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Staff } from '../../types'

/**
 * Admin-only component: shows all staff members and lets admin toggle
 * totp_required per staff member. Intended to be embedded in clinic settings.
 *
 * Security: only rendered when current user role === 'admin'.
 * RLS on staff table ensures non-admin writes are rejected at DB level.
 */
export function StaffMFASettings() {
  const { clinic, role } = useAuth()
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [saving, setSaving]       = useState<string | null>(null) // staff id being saved
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    if (!clinic?.id) return
    supabase
      .from('staff')
      .select('id, name, role, totp_required')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setStaffList(data as Staff[])
      })
  }, [clinic?.id])

  if (role !== 'admin') return null

  async function toggleTotp(staffMember: Staff) {
    const next = !staffMember.totp_required

    // Require explicit confirmation before disabling 2FA — accidental click = security downgrade
    if (!next && !window.confirm(
      `Disable two-factor authentication for ${staffMember.name}?\n\n` +
      `This means they can log in with only a password. ` +
      `Doctors should always keep 2FA enabled.`
    )) {
      return
    }

    setSaving(staffMember.id)
    setError(null)

    const { error: updateError } = await supabase
      .from('staff')
      .update({ totp_required: next })
      .eq('id', staffMember.id)

    if (updateError) {
      setError(`Failed to update ${staffMember.name}: ${updateError.message}`)
    } else {
      setStaffList((prev) =>
        prev.map((s) =>
          s.id === staffMember.id ? { ...s, totp_required: next } : s
        )
      )
    }

    setSaving(null)
  }

  return (
    <section aria-labelledby="mfa-settings-heading">
      <h2
        id="mfa-settings-heading"
        className="mb-1 text-base font-semibold text-[#164e63]"
      >
        Two-Factor Authentication
      </h2>
      <p className="mb-4 text-sm text-[#0e7490]">
        Control which staff members are required to verify with TOTP on each login.
        Doctors should always have 2FA enabled.
      </p>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-[#164e63]">Name</th>
              <th className="px-4 py-3 text-left font-medium text-[#164e63]">Role</th>
              <th className="px-4 py-3 text-right font-medium text-[#164e63]">Require 2FA</th>
            </tr>
          </thead>
          <tbody>
            {staffList.map((s, i) => (
              <tr
                key={s.id}
                className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
              >
                <td className="px-4 py-3 text-[#164e63]">{s.name}</td>
                <td className="px-4 py-3 capitalize text-[#0e7490]">{s.role}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleTotp(s)}
                    disabled={saving === s.id}
                    aria-label={
                      s.totp_required
                        ? `Disable 2FA for ${s.name}`
                        : `Enable 2FA for ${s.name}`
                    }
                    className={[
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      s.totp_required
                        ? 'bg-[#cffafe] text-[#0e7490] hover:bg-[#a5f3fc]'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                      saving === s.id ? 'cursor-not-allowed opacity-50' : '',
                    ].join(' ')}
                  >
                    {s.totp_required
                      ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      : <ShieldOff   className="h-3.5 w-3.5" aria-hidden="true" />
                    }
                    {saving === s.id
                      ? 'Saving…'
                      : s.totp_required ? 'Required' : 'Off'
                    }
                  </button>
                </td>
              </tr>
            ))}

            {staffList.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">
                  No active staff found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
