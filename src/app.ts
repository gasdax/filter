import goldVideoUrl from '../单抽出金.mp4'
import blueVideoUrl from '../单抽出蓝.mp4'
import type { DrawResult, Student } from './types'

type PublicState = {
  summary: {
    totalStudents: number
    selectedCount: number
    remainingSlots: number
    dynamicProbability: number
    remainingStudents: number
  }
  winners: Student[]
  rosterPreview: Student[]
}

type Session =
  | { role: 'guest'; token: string | null }
  | { role: 'admin'; token: string }
  | { role: 'student'; token: string; student: Student & { attemptsLeft: number } }

type MeResponse =
  | { role: 'guest' }
  | { role: 'admin' }
  | { role: 'student'; student: Student & { attemptsLeft: number } }

type OverlayState =
  | { mode: 'idle' }
  | { mode: 'win'; result: DrawResult; revealResult: boolean }
  | { mode: 'lose'; result: DrawResult; revealResult: boolean }

type AppOptions = {
  storage?: boolean
}

const AUTH_KEY = 'student-lottery-auth-token'

let refreshTimer: number | null = null

export function initApp(root: HTMLElement, _options: AppOptions = {}): void {
  void _options
  let state: PublicState = {
    summary: {
      totalStudents: 0,
      selectedCount: 0,
      remainingSlots: 35,
      dynamicProbability: 0,
      remainingStudents: 0,
    },
    winners: [],
    rosterPreview: [],
  }
  let session: Session = { role: 'guest', token: loadToken() }
  let lastDraw: DrawResult | null = null
  let overlayState: OverlayState = { mode: 'idle' }
  let bulkText = ''
  let studentIdDraft = ''
  let studentPasswordDraft = ''
  let adminPasswordDraft = ''
  let loading = true
  let errorMessage = ''
  let suspendPollingRender = false

  void bootstrap()
  startPolling()

  function startPolling(): void {
    if (refreshTimer !== null) {
      window.clearInterval(refreshTimer)
    }

    refreshTimer = window.setInterval(() => {
      void refreshState()
    }, 4000)
  }

  async function bootstrap(): Promise<void> {
    await refreshState()
    render()
  }

  async function refreshState(): Promise<void> {
    try {
      loading = true
      const [publicState, me] = await Promise.all([
        apiGet<PublicState>('/api/public/state'),
        session.token ? apiGet<MeResponse>('/api/me', session.token) : Promise.resolve<MeResponse>({ role: 'guest' }),
      ])

      state = publicState
      if (me.role === 'student' && session.token) {
        session = {
          role: 'student',
          token: session.token,
          student: me.student,
        }
      } else if (me.role === 'admin' && session.token) {
        session = {
          role: 'admin',
          token: session.token,
        }
      } else {
        session = { role: 'guest', token: null }
        clearToken()
      }

      errorMessage = ''
    } catch (error) {
      errorMessage = getErrorMessage(error)
    } finally {
      loading = false
      if (overlayState.mode === 'idle' && !suspendPollingRender) {
        render()
      }
    }
  }

  function buildAvatar(student: Student): string {
    if (student.avatarUrl) {
      return `<img src="${student.avatarUrl}" alt="${student.name}" class="avatar-image" />`
    }

    const seed = [...student.studentId].reduce((sum, char) => sum + char.charCodeAt(0), 0)
    const hue = seed % 360

    return `<div class="avatar-fallback" style="--avatar-hue:${hue}" aria-label="${student.name}">${student.name.slice(0, 2)}</div>`
  }

  function render(): void {
    const currentStudent = session.role === 'student' ? session.student : null
    const adminUnlocked = session.role === 'admin'

    root.innerHTML = `
      <div class="app-shell">
        <div class="cinematic-overlay ${overlayState.mode !== 'idle' ? 'is-active' : ''}">
          ${
            overlayState.mode === 'win'
              ? `
                  <video class="overlay-video" data-role="overlay-video" src="${goldVideoUrl}" autoplay muted preload="auto" playsinline></video>
                  <div class="overlay-result ${overlayState.revealResult ? 'is-visible' : ''}">
                    <div class="overlay-result-card">
                      <div class="overlay-avatar">${buildAvatar(overlayState.result.student)}</div>
                      <p class="overlay-badge">恭喜中签</p>
                      <h2 data-testid="winner-name">${overlayState.result.student.name}</h2>
                      <p>${overlayState.result.student.studentId}</p>
                      <p class="overlay-number">${overlayState.result.student.contestNumber ?? ''}</p>
                    </div>
                  </div>
                `
              : ''
          }
          ${
            overlayState.mode === 'lose'
              ? `
                  <video class="overlay-video" data-role="overlay-lose-video" src="${blueVideoUrl}" autoplay muted preload="auto" playsinline></video>
                  <div class="overlay-encourage ${overlayState.revealResult ? 'is-visible' : ''}">
                    <div class="overlay-encourage-inner">
                      <p class="overlay-badge">这次未中签</p>
                      <h2>继续加油</h2>
                      <p>${overlayState.result.message}</p>
                      <strong>剩余抽奖次数 ${currentStudent?.attemptsLeft ?? 0}</strong>
                    </div>
                  </div>
                `
              : ''
          }
        </div>

        <header class="hero-panel">
          <div class="hero-copy">
            <p class="eyebrow">多人在线抽签版</p>
            <h1>星辉参赛祈愿</h1>
            <p class="hero-desc">
              现在所有抽奖状态都由服务端统一管理。多个学生可以同时在线登录各自账号抽奖，35 个参赛名额也会由服务器全局控制。
            </p>
            ${errorMessage ? `<p class="error-banner">${errorMessage}</p>` : ''}
          </div>
          <div class="stats-grid">
            <article class="stat-card">
              <span class="stat-label">报名总人数</span>
              <strong class="stat-value" data-testid="total-count">${state.summary.totalStudents}</strong>
            </article>
            <article class="stat-card">
              <span class="stat-label">已中签人数</span>
              <strong class="stat-value" data-testid="selected-count">${state.summary.selectedCount}</strong>
            </article>
            <article class="stat-card">
              <span class="stat-label">剩余参赛名额</span>
              <strong class="stat-value" data-testid="remaining-slots">${state.summary.remainingSlots}</strong>
            </article>
            <article class="stat-card">
              <span class="stat-label">当前基础中签率</span>
              <strong class="stat-value">${(state.summary.dynamicProbability * 100).toFixed(2)}%</strong>
            </article>
          </div>
        </header>

        <main class="main-grid">
          <section class="panel control-panel">
            <div class="section-head">
              <h2>学生入口</h2>
              <p>每位学生只能使用自己的学号和口令登录，抽奖状态保存在服务端。</p>
            </div>

            <form class="single-form" data-role="student-login-form">
              <label>
                <span>学号登录</span>
                <input name="studentId" value="${escapeHtml(studentIdDraft)}" placeholder="请输入学号" required />
              </label>
              <label>
                <span>登录口令</span>
                <input name="studentPassword" type="password" value="${escapeHtml(studentPasswordDraft)}" placeholder="演示版默认取学号后 6 位" required />
              </label>
              <div class="inline-actions">
                <button type="submit" class="action action-primary">学生登录</button>
                <button type="button" class="action" data-role="student-logout">退出学生账号</button>
              </div>
            </form>
            <p class="rule-note">演示版学生口令默认使用学号后 6 位，例如 20260001 的口令是 260001。</p>

            <div class="player-panel">
              ${
                currentStudent
                  ? `
                      <div class="player-card">
                        <div class="player-avatar">${buildAvatar(currentStudent)}</div>
                        <div>
                          <p class="tiny-label">当前学生</p>
                          <h3 data-testid="current-student-name">${currentStudent.name}</h3>
                          <p>${currentStudent.studentId}</p>
                          <p>剩余抽奖次数：${currentStudent.attemptsLeft} / ${currentStudent.chances}</p>
                          <p>${currentStudent.selectedAt ? `已中签，参赛号码 ${currentStudent.contestNumber}` : '尚未中签，可继续抽奖。'}</p>
                        </div>
                      </div>
                    `
                  : '<p class="empty-state">当前尚未登录学生账号。</p>'
              }
            </div>

            <div class="admin-box">
              <div class="section-head">
                <h2>管理员入口</h2>
                <p>只有管理员登录后，名单导入和重置操作才会开放。</p>
              </div>
              <form class="single-form" data-role="admin-login-form">
                <label>
                  <span>管理员口令</span>
                  <input name="adminPassword" type="password" value="${escapeHtml(adminPasswordDraft)}" placeholder="请输入管理员口令" />
                </label>
                <div class="inline-actions">
                  <button type="submit" class="action">管理员登录</button>
                  <button type="button" class="action" data-role="admin-logout">管理员退出</button>
                </div>
              </form>
              ${
                adminUnlocked
                  ? `
                      <p class="admin-status">管理员已解锁，当前可以管理学生名单。</p>
                      <form class="single-form" data-role="single-form">
                        <label>
                          <span>姓名</span>
                          <input name="name" placeholder="例如：李子涵" />
                        </label>
                        <label>
                          <span>学号</span>
                          <input name="newStudentId" placeholder="例如：20260123" />
                        </label>
                        <label>
                          <span>头像链接</span>
                          <input name="avatarUrl" placeholder="可选" />
                        </label>
                        <button type="submit" class="action">添加学生</button>
                      </form>
                      <div class="bulk-import">
                        <label for="bulk-input">批量导入</label>
                        <textarea id="bulk-input" data-role="bulk-input" placeholder="每行：姓名,学号,头像链接(可选)">${bulkText}</textarea>
                        <div class="inline-actions">
                          <button type="button" class="action" data-role="bulk-import">导入名单</button>
                          <button type="button" class="action" data-role="seed-demo">重载 240 人演示数据</button>
                          <button type="button" class="action action-danger" data-role="reset-draws">清空抽签结果</button>
                        </div>
                      </div>
                    `
                  : '<p class="empty-state">管理员未登录时，名单管理入口保持隐藏。</p>'
              }
            </div>
          </section>

          <section class="panel stage-panel">
            <div class="section-head">
              <h2>个人抽奖舞台</h2>
              <p>抽奖请求会发往服务端，结果对所有在线用户实时可见。</p>
            </div>

            <div class="summon-stage ${lastDraw?.outcome === 'win' ? 'is-win' : lastDraw?.outcome === 'lose' ? 'is-lose' : ''}">
              <div class="stage-backdrop"></div>
              <div class="result-card">
                ${
                  currentStudent && lastDraw
                    ? `
                        <div class="winner-avatar">${buildAvatar(currentStudent)}</div>
                        <div class="winner-copy">
                          <p class="rarity">${lastDraw.outcome === 'win' ? '恭喜中签' : '继续加油'}</p>
                          <h3>${currentStudent.name}</h3>
                          <p>${lastDraw.outcome === 'win' ? currentStudent.contestNumber ?? '' : `剩余抽奖次数 ${currentStudent.attemptsLeft}`}</p>
                          <p class="draw-message">${lastDraw.message}</p>
                        </div>
                      `
                    : `
                        <div class="placeholder-copy">
                          <p>${loading ? '正在同步服务器状态…' : '登录后点击下方按钮开始抽奖'}</p>
                          <span>多人在线时，这里的统计和中签名单会自动刷新</span>
                        </div>
                      `
                }
              </div>
            </div>

            <div class="inline-actions">
              <button type="button" class="action action-primary" data-role="draw-once" ${
                session.role === 'student' &&
                currentStudent !== null &&
                currentStudent.attemptsLeft > 0 &&
                !currentStudent.selectedAt &&
                overlayState.mode === 'idle'
                  ? ''
                  : 'disabled'
              }>发起 1 次抽奖</button>
              <button type="button" class="action" data-role="refresh-state">立即刷新状态</button>
            </div>
            <p class="rule-note">
              ${
                currentStudent
                  ? `当前学生剩余 ${currentStudent.attemptsLeft} 次机会；全场剩余 ${state.summary.remainingStudents} 位未中签学生。`
                  : '请先登录学生账号，系统会自动与服务器同步最新抽奖状态。'
              }
            </p>
          </section>
        </main>

        <section class="results-grid">
          <section class="panel winners-panel">
            <div class="section-head">
              <h2>中签名单</h2>
              <p>所有在线用户都会看到同一份服务端结果。</p>
            </div>
            <div class="winner-list">
              ${
                state.winners.length
                  ? state.winners
                      .map(
                        (student) => `
                          <article class="winner-item">
                            <span class="winner-rank">${student.contestNumber ?? ''}</span>
                            <div class="winner-mini-avatar">${buildAvatar(student)}</div>
                            <div>
                              <strong>${student.name}</strong>
                              <p>${student.studentId}</p>
                            </div>
                          </article>
                        `,
                      )
                      .join('')
                  : '<p class="empty-state">暂时还没有学生中签。</p>'
              }
            </div>
          </section>

          <section class="panel roster-panel">
            <div class="section-head">
              <h2>报名池概览</h2>
              <p>这里显示的是服务器上的统一名单预览。</p>
            </div>
            <div class="student-grid">
              ${state.rosterPreview
                .map(
                  (student) => `
                    <article class="student-card ${student.selectedAt ? 'is-selected' : ''}">
                      <div class="student-avatar">${buildAvatar(student)}</div>
                      <div>
                        <strong>${student.name}</strong>
                        <p>${student.studentId}</p>
                        <span>${student.selectedAt ? `已中签 ${student.contestNumber}` : `待抽取中`}</span>
                      </div>
                    </article>
                  `,
                )
                .join('')}
            </div>
          </section>
        </section>
      </div>
    `

    bindEvents()
  }

  function bindEvents(): void {
    const studentLoginForm = root.querySelector<HTMLFormElement>('[data-role="student-login-form"]')
    const studentLogoutButton = root.querySelector<HTMLButtonElement>('[data-role="student-logout"]')
    const adminLoginForm = root.querySelector<HTMLFormElement>('[data-role="admin-login-form"]')
    const adminLogoutButton = root.querySelector<HTMLButtonElement>('[data-role="admin-logout"]')
    const drawButton = root.querySelector<HTMLButtonElement>('[data-role="draw-once"]')
    const refreshButton = root.querySelector<HTMLButtonElement>('[data-role="refresh-state"]')
    const addStudentForm = root.querySelector<HTMLFormElement>('[data-role="single-form"]')
    const bulkInput = root.querySelector<HTMLTextAreaElement>('[data-role="bulk-input"]')
    const importButton = root.querySelector<HTMLButtonElement>('[data-role="bulk-import"]')
    const seedButton = root.querySelector<HTMLButtonElement>('[data-role="seed-demo"]')
    const resetButton = root.querySelector<HTMLButtonElement>('[data-role="reset-draws"]')
    const overlayVideo = root.querySelector<HTMLVideoElement>('[data-role="overlay-video"]')
    const overlayLoseVideo = root.querySelector<HTMLVideoElement>('[data-role="overlay-lose-video"]')
    const studentIdInput = root.querySelector<HTMLInputElement>('form[data-role="student-login-form"] input[name="studentId"]')
    const studentPasswordInput = root.querySelector<HTMLInputElement>('form[data-role="student-login-form"] input[name="studentPassword"]')
    const adminPasswordInput = root.querySelector<HTMLInputElement>('form[data-role="admin-login-form"] input[name="adminPassword"]')

    studentIdInput?.addEventListener('input', () => {
      studentIdDraft = studentIdInput.value
    })
    studentIdInput?.addEventListener('focus', () => {
      suspendPollingRender = true
    })
    studentIdInput?.addEventListener('blur', () => {
      suspendPollingRender = false
      render()
    })

    studentPasswordInput?.addEventListener('input', () => {
      studentPasswordDraft = studentPasswordInput.value
    })
    studentPasswordInput?.addEventListener('focus', () => {
      suspendPollingRender = true
    })
    studentPasswordInput?.addEventListener('blur', () => {
      suspendPollingRender = false
      render()
    })

    adminPasswordInput?.addEventListener('input', () => {
      adminPasswordDraft = adminPasswordInput.value
    })
    adminPasswordInput?.addEventListener('focus', () => {
      suspendPollingRender = true
    })
    adminPasswordInput?.addEventListener('blur', () => {
      suspendPollingRender = false
      render()
    })

    studentLoginForm?.addEventListener('submit', async (event) => {
      event.preventDefault()
      suspendPollingRender = false
      try {
        const response = await apiPost<{ token: string; role: 'student'; student: Student & { attemptsLeft: number } }>('/api/auth/student/login', {
          studentId: studentIdDraft,
          password: studentPasswordDraft,
        })
        session = { role: 'student', token: response.token, student: response.student }
        saveToken(response.token)
        lastDraw = null
        studentIdDraft = ''
        studentPasswordDraft = ''
        await refreshState()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    studentLogoutButton?.addEventListener('click', async () => {
      await logout()
    })

    adminLoginForm?.addEventListener('submit', async (event) => {
      event.preventDefault()
      suspendPollingRender = false
      try {
        const response = await apiPost<{ token: string; role: 'admin' }>('/api/auth/admin/login', { password: adminPasswordDraft })
        session = { role: 'admin', token: response.token }
        saveToken(response.token)
        adminPasswordDraft = ''
        await refreshState()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    adminLogoutButton?.addEventListener('click', async () => {
      await logout()
    })

    drawButton?.addEventListener('click', async () => {
      if (session.role !== 'student') {
        return
      }

      try {
        const response = await apiPost<{ result: DrawResult; state: PublicState; me: { role: 'student'; student: Student & { attemptsLeft: number } } }>('/api/draw', {}, session.token)
        lastDraw = response.result
        state = response.state
        session = { role: 'student', token: session.token, student: response.me.student }
        overlayState =
          response.result.outcome === 'win'
            ? { mode: 'win', result: response.result, revealResult: false }
            : { mode: 'lose', result: response.result, revealResult: false }
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    refreshButton?.addEventListener('click', () => {
      void refreshState()
    })

    addStudentForm?.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (session.role !== 'admin') {
        return
      }

      const formData = new FormData(addStudentForm)
      try {
        const response = await apiPost<{ state: PublicState }>(
          '/api/admin/students',
          {
            name: String(formData.get('name') ?? ''),
            studentId: String(formData.get('newStudentId') ?? ''),
            avatarUrl: String(formData.get('avatarUrl') ?? ''),
          },
          session.token,
        )
        state = response.state
        addStudentForm.reset()
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    bulkInput?.addEventListener('input', () => {
      bulkText = bulkInput.value
    })

    importButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') {
        return
      }

      try {
        const response = await apiPost<{ state: PublicState }>('/api/admin/bulk-import', { raw: bulkText }, session.token)
        state = response.state
        bulkText = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    seedButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') {
        return
      }

      const response = await apiPost<{ state: PublicState }>('/api/admin/seed', {}, session.token)
      state = response.state
      lastDraw = null
      render()
    })

    resetButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') {
        return
      }

      const response = await apiPost<{ state: PublicState }>('/api/admin/reset', {}, session.token)
      state = response.state
      lastDraw = null
      render()
    })

    overlayVideo?.addEventListener('ended', () => {
      if (overlayState.mode !== 'win') {
        return
      }

      overlayState = { ...overlayState, revealResult: true }
      render()

      window.setTimeout(() => {
        overlayState = { mode: 'idle' }
        void refreshState()
        render()
      }, 4600)
    })

    overlayLoseVideo?.addEventListener('ended', () => {
      if (overlayState.mode !== 'lose') {
        return
      }

      overlayState = { ...overlayState, revealResult: true }
      render()

      window.setTimeout(() => {
        overlayState = { mode: 'idle' }
        void refreshState()
        render()
      }, 3800)
    })
  }

  async function logout(): Promise<void> {
    if (session.token) {
      await apiPost('/api/auth/logout', {}, session.token).catch(() => undefined)
    }

    session = { role: 'guest', token: null }
    clearToken()
    lastDraw = null
    await refreshState()
  }
}

function loadToken(): string | null {
  return localStorage.getItem(AUTH_KEY)
}

function saveToken(token: string): void {
  localStorage.setItem(AUTH_KEY, token)
}

function clearToken(): void {
  localStorage.removeItem(AUTH_KEY)
}

async function apiGet<T = unknown>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  return handleResponse<T>(response)
}

async function apiPost<T = unknown>(url: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  return handleResponse<T>(response)
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.')
  }

  return data as T
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
