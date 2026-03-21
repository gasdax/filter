import { fireEvent, waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initApp } from './app'

function createFetchMock() {
  const student = {
    id: '1',
    name: '测试学生',
    studentId: '20260001',
    avatarUrl: '',
    chances: 10,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
    attemptsLeft: 10,
  }

  const publicState = {
    summary: {
      totalStudents: 240,
      selectedCount: 0,
      remainingSlots: 35,
      dynamicProbability: 0.0145,
      remainingStudents: 240,
    },
    winners: [],
    rosterPreview: [student],
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const auth = init?.headers && typeof init.headers === 'object' && 'Authorization' in init.headers
      ? String((init.headers as Record<string, string>).Authorization)
      : ''

    if (url === '/api/public/state') {
      return new Response(JSON.stringify(publicState), { status: 200 })
    }

    if (url === '/api/me') {
      if (auth === 'Bearer student-token') {
        return new Response(JSON.stringify({ role: 'student', student }), { status: 200 })
      }
      if (auth === 'Bearer admin-token') {
        return new Response(JSON.stringify({ role: 'admin' }), { status: 200 })
      }
      return new Response(JSON.stringify({ role: 'guest' }), { status: 200 })
    }

    if (url === '/api/auth/student/login' && method === 'POST') {
      return new Response(JSON.stringify({ token: 'student-token', role: 'student', student }), { status: 200 })
    }

    if (url === '/api/auth/admin/login' && method === 'POST') {
      return new Response(JSON.stringify({ token: 'admin-token', role: 'admin' }), { status: 200 })
    }

    if (url === '/api/auth/logout' && method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'Unhandled request' }), { status: 500 })
  })
}

describe('app', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
    vi.stubGlobal('fetch', createFetchMock())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders server-backed stats', async () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) {
      throw new Error('Missing root')
    }

    initApp(root)

    await waitFor(() => {
      expect(document.querySelector('[data-testid="total-count"]')?.textContent).toBe('240')
      expect(document.querySelector('[data-testid="selected-count"]')?.textContent).toBe('0')
    })
  })

  it('logs in a student through the API flow', async () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) {
      throw new Error('Missing root')
    }

    initApp(root)

    await waitFor(() => {
      expect(document.querySelector('form[data-role="student-login-form"]')).toBeTruthy()
    })

    fireEvent.input(document.querySelector('form[data-role="student-login-form"] input[name="studentId"]')!, {
      target: { value: '20260001' },
    })
    fireEvent.input(document.querySelector('form[data-role="student-login-form"] input[name="studentPassword"]')!, {
      target: { value: '260001' },
    })
    fireEvent.submit(document.querySelector('form[data-role="student-login-form"]')!)

    await waitFor(() => {
      expect(document.querySelector('[data-testid="current-student-name"]')?.textContent).toBe('测试学生')
    })
  })

  it('unlocks admin controls only after admin login', async () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) {
      throw new Error('Missing root')
    }

    initApp(root)

    await waitFor(() => {
      expect(document.querySelector('form[data-role="admin-login-form"]')).toBeTruthy()
    })

    expect(document.body.textContent?.includes('管理员已解锁')).toBe(false)

    fireEvent.input(document.querySelector('form[data-role="admin-login-form"] input[name="adminPassword"]')!, {
      target: { value: 'admin2026' },
    })
    fireEvent.submit(document.querySelector('form[data-role="admin-login-form"]')!)

    await waitFor(() => {
      expect(document.body.textContent?.includes('管理员已解锁')).toBe(true)
    })
  })
})
