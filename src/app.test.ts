import { fireEvent, waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initApp } from './app'

function createFetchMock() {
  const student = {
    id: '1',
    name: 'Test Student',
    studentId: '20260001',
    phoneNumber: '13800138000',
    avatarUrl: '',
    chances: 20,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
    attemptsLeft: 20,
  }

  const publicState = {
    summary: {
      totalStudents: 1,
      selectedCount: 0,
      winnerTarget: 35,
      remainingSlots: 35,
      dynamicProbability: 1,
      remainingStudents: 1,
      whitelistCount: 240,
      drawEnabled: false,
    },
    winners: [],
    rosterPreview: [student],
  }

  const adminState = {
    summary: publicState.summary,
    allowedStudentIds: ['20260001', '20260002'],
    students: [student],
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const authHeader = init?.headers && typeof init.headers === 'object' && 'Authorization' in init.headers
      ? String((init.headers as Record<string, string>).Authorization)
      : ''

    if (url === '/api/public/state') {
      return new Response(JSON.stringify(publicState), { status: 200 })
    }

    if (url === '/api/me') {
      if (authHeader === 'Bearer student-token') {
        return new Response(JSON.stringify({ role: 'student', student }), { status: 200 })
      }
      if (authHeader === 'Bearer admin-token') {
        return new Response(JSON.stringify({ role: 'admin' }), { status: 200 })
      }
      return new Response(JSON.stringify({ role: 'guest' }), { status: 200 })
    }

    if (url === '/api/admin/state' && method === 'GET') {
      return new Response(JSON.stringify(adminState), { status: 200 })
    }

    if (url === '/api/auth/student/register' && method === 'POST') {
      return new Response(JSON.stringify({ token: 'student-token', role: 'student', student, state: publicState }), { status: 200 })
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

    if (url === '/api/admin/allowed-student-ids' && method === 'POST') {
      return new Response(JSON.stringify({ state: publicState }), { status: 200 })
    }

    if (url === '/api/admin/seed' && method === 'POST') {
      return new Response(JSON.stringify({ state: publicState }), { status: 200 })
    }

    if (url === '/api/admin/reset' && method === 'POST') {
      return new Response(JSON.stringify({ state: publicState }), { status: 200 })
    }

    if (url === '/api/admin/reset-registrations' && method === 'POST') {
      return new Response(JSON.stringify({ state: publicState }), { status: 200 })
    }

    if (url === '/api/admin/students/chances' && method === 'POST') {
      return new Response(JSON.stringify({ state: adminState, student }), { status: 200 })
    }

    if (url === '/api/admin/winner-target' && method === 'POST') {
      return new Response(JSON.stringify(adminState), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'Unhandled request' }), { status: 500 })
  })
}

describe('app', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
    vi.stubGlobal('fetch', createFetchMock())
    localStorage.clear()
    window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders updated server-backed stats', async () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) throw new Error('Missing root')

    initApp(root)

    await waitFor(() => {
      expect(document.querySelector('[data-testid="total-count"]')?.textContent).toBe('1')
      expect(document.querySelector('[data-testid="remaining-slots"]')?.textContent).toBe('35')
    })
  })

  it('registers a student through the API flow', async () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) throw new Error('Missing root')

    initApp(root)

    await waitFor(() => {
      expect(document.querySelector('form[data-role="student-register-form"]')).toBeTruthy()
    })

    fireEvent.input(document.querySelector('input[name="registerStudentId"]')!, { target: { value: '20260001' } })
    fireEvent.input(document.querySelector('input[name="registerPassword"]')!, { target: { value: 'secret123' } })
    fireEvent.input(document.querySelector('input[name="registerName"]')!, { target: { value: 'Test Student' } })
    fireEvent.input(document.querySelector('input[name="registerPhone"]')!, { target: { value: '13800138000' } })
    fireEvent.submit(document.querySelector('form[data-role="student-register-form"]')!)

    await waitFor(() => {
      expect(document.body.textContent?.includes('注册成功')).toBe(true)
    })
  })

  it('opens the admin login page and shows the admin dashboard after login', async () => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) throw new Error('Missing root')

    window.history.pushState({}, '', '/admin')
    initApp(root)

    await waitFor(() => {
      expect(document.querySelector('form[data-role="admin-login-form"]')).toBeTruthy()
    })

    fireEvent.input(document.querySelector('input[name="adminPassword"]')!, { target: { value: 'admin2026' } })
    fireEvent.submit(document.querySelector('form[data-role="admin-login-form"]')!)

    await waitFor(() => {
      expect(document.body.textContent?.includes('已注册用户管理')).toBe(true)
    })
  })
})
