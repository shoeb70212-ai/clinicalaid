import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateQueueStatus, updateQueueNotes, verifyIdentity } from '../occ'

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(),
            })),
          })),
        })),
      })),
    })),
  },
}))

const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({
  eq: vi.fn(() => ({
    select: vi.fn(() => ({
      single: mockSingle,
    })),
  })),
}))
const mockUpdate = vi.fn(() => ({
  eq: mockEq,
}))

import { supabase } from '../supabase'

describe('updateQueueStatus (OCC)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      update: mockUpdate,
    } as any)
  })

  it('returns success true with data on successful update', async () => {
    const mockData = { id: 'entry-1', version: 2, status: 'CALLED' }
    mockSingle.mockResolvedValue({ data: mockData, error: null })

    const result = await updateQueueStatus('entry-1', 1, 'CALLED')

    expect(result.success).toBe(true)
    expect(result.data).toEqual(mockData)
    expect(result.reason).toBeUndefined()
  })

  it('returns conflict when version mismatch (PGRST116 error)', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const result = await updateQueueStatus('entry-1', 1, 'CALLED')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('conflict')
  })

  it('returns conflict when data is null but no error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null })

    const result = await updateQueueStatus('entry-1', 1, 'CALLED')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('conflict')
  })

  it('returns error on genuine database errors', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST200', message: 'Invalid syntax' },
    })

    const result = await updateQueueStatus('entry-1', 1, 'CALLED')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('error')
  })

  it('returns success for IN_CONSULTATION transition', async () => {
    const mockData = { id: 'entry-1', version: 2, status: 'IN_CONSULTATION' }
    mockSingle.mockResolvedValue({ data: mockData, error: null })

    const result = await updateQueueStatus('entry-1', 1, 'IN_CONSULTATION')

    expect(result.success).toBe(true)
    expect(result.data?.status).toBe('IN_CONSULTATION')
  })

  it('returns success for COMPLETED transition', async () => {
    const mockData = { id: 'entry-1', version: 2, status: 'COMPLETED' }
    mockSingle.mockResolvedValue({ data: mockData, error: null })

    const result = await updateQueueStatus('entry-1', 1, 'COMPLETED')

    expect(result.success).toBe(true)
    expect(result.data?.status).toBe('COMPLETED')
  })
})

describe('updateQueueNotes (OCC)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      update: mockUpdate,
    } as any)
  })

  it('returns success when notes are updated', async () => {
    const mockData = { id: 'entry-1', version: 2, notes: '{"chiefComplaint": "test"}' }
    mockSingle.mockResolvedValue({ data: mockData, error: null })

    const result = await updateQueueNotes('entry-1', 1, '{"chiefComplaint": "test"}')

    expect(result.success).toBe(true)
    expect(result.data?.notes).toBe('{"chiefComplaint": "test"}')
  })

  it('returns conflict on version mismatch', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const result = await updateQueueNotes('entry-1', 1, '{"chiefComplaint": "test"}')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('conflict')
  })
})

describe('verifyIdentity (OCC)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      update: mockUpdate,
    } as any)
  })

  it('returns success when identity is verified', async () => {
    const mockData = { id: 'entry-1', version: 2, identity_verified: true }
    mockSingle.mockResolvedValue({ data: mockData, error: null })

    const result = await verifyIdentity('entry-1', 1)

    expect(result.success).toBe(true)
    expect(result.data?.identity_verified).toBe(true)
  })

  it('returns conflict on version mismatch', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const result = await verifyIdentity('entry-1', 1)

    expect(result.success).toBe(false)
    expect(result.reason).toBe('conflict')
  })
})