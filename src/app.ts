import registerVideoUrl from '../注册.mp4'
import goldVideoUrl from '../单抽出金.mp4'
import blueVideoUrl from '../单抽出蓝.mp4'
import type { DrawResult, Student } from './types'

type Summary = {
  totalStudents: number
  selectedCount: number
  winnerTarget: number
  remainingSlots: number
  dynamicProbability: number
  remainingStudents: number
  whitelistCount: number
  drawEnabled: boolean
}

type PublicState = {
  summary: Summary
  winners: Student[]
  rosterPreview: Student[]
}

type StudentSession = Student & { attemptsLeft: number }

type AdminState = {
  summary: Summary
  allowedStudentIds: string[]
  students: StudentSession[]
}

type Session =
  | { role: 'guest'; token: string | null }
  | { role: 'student'; token: string; student: StudentSession }
  | { role: 'admin'; token: string }

type MeResponse =
  | { role: 'guest' }
  | { role: 'admin' }
  | { role: 'student'; student: StudentSession }

type OverlayState =
  | { mode: 'idle' }
  | { mode: 'register' }
  | { mode: 'win'; result: DrawResult; revealResult: boolean }
  | { mode: 'lose'; result: DrawResult; revealResult: boolean }

type RegisterResult =
  | { status: 'idle' }
  | { status: 'success'; title: string; detail: string }
  | { status: 'fail'; title: string; detail: string }

type Screen = 'student-register' | 'student-login' | 'register-result' | 'student-dashboard' | 'admin-login' | 'admin-dashboard'

const AUTH_KEY = 'student-lottery-auth-token'
let refreshTimer: number | null = null

export function initApp(root: HTMLElement): void {
  let hasRendered = false
  let publicState: PublicState = {
    summary: {
      totalStudents: 0,
      selectedCount: 0,
      winnerTarget: 35,
      remainingSlots: 35,
      dynamicProbability: 0,
      remainingStudents: 0,
      whitelistCount: 0,
      drawEnabled: false,
    },
    winners: [],
    rosterPreview: [],
  }

  let adminState: AdminState = {
    summary: publicState.summary,
    allowedStudentIds: [],
    students: [],
  }

  let session: Session = { role: 'guest', token: loadToken() }
  let screen: Screen = window.location.pathname === '/admin' ? 'admin-login' : 'student-register'
  let overlayState: OverlayState = { mode: 'idle' }
  let registerResult: RegisterResult = { status: 'idle' }
  let lastDraw: DrawResult | null = null
  let loading = true
  let errorMessage = ''
  let suspendPollingRender = false

  let studentIdDraft = ''
  let studentPasswordDraft = ''
  let registerNameDraft = ''
  let registerPhoneDraft = ''
  let registerAvatarDraft = ''
  let registerAvatarName = ''
  let adminPasswordDraft = ''
  let allowedIdsDraft = ''
  let winnerTargetDraft = ''
  let chancesDrafts: Record<string, string> = {}

  void bootstrap()
  startPolling()

  function startPolling(): void {
    if (refreshTimer !== null) {
      window.clearInterval(refreshTimer)
    }

    refreshTimer = window.setInterval(() => {
      if (screen === 'student-dashboard') {
        void refreshPublicAndSession()
      }
    }, 4000)
  }

  async function bootstrap(): Promise<void> {
    await refreshPublicAndSession(true)
  }

  async function refreshPublicAndSession(forceRender = false): Promise<void> {
    const previousRenderState = createRenderStateSignature()

    try {
      loading = true
      const [nextPublicState, me] = await Promise.all([
        apiGet<PublicState>('/api/public/state'),
        session.token ? apiGet<MeResponse>('/api/me', session.token) : Promise.resolve<MeResponse>({ role: 'guest' }),
      ])

      publicState = nextPublicState

      if (me.role === 'student' && session.token) {
        session = { role: 'student', token: session.token, student: me.student }
        if (screen !== 'register-result') {
          screen = 'student-dashboard'
        }
      } else if (me.role === 'admin' && session.token) {
        session = { role: 'admin', token: session.token }
        await refreshAdminState()
        screen = 'admin-dashboard'
      } else {
        session = { role: 'guest', token: null }
        clearToken()
        screen = window.location.pathname === '/admin' ? 'admin-login' : screen === 'register-result' ? 'register-result' : 'student-register'
      }

      errorMessage = ''
    } catch (error) {
      errorMessage = getErrorMessage(error)
    } finally {
      loading = false
      const nextRenderState = createRenderStateSignature()
      if (overlayState.mode === 'idle' && !suspendPollingRender && (forceRender || !hasRendered || previousRenderState !== nextRenderState)) {
        render()
      }
    }
  }

  async function refreshAdminState(): Promise<void> {
    if (session.role !== 'admin') {
      return
    }

    adminState = await apiGet<AdminState>('/api/admin/state', session.token)
    allowedIdsDraft = adminState.allowedStudentIds.join('\n')
    winnerTargetDraft = String(adminState.summary.winnerTarget)
    chancesDrafts = Object.fromEntries(adminState.students.map((student) => [student.studentId, String(student.chances)]))
  }

  function buildAvatar(student: Student): string {
    if (student.avatarUrl) {
      return `<img src="${student.avatarUrl}" alt="${escapeHtml(student.name)}" class="avatar-image" />`
    }

    const hue = [...student.studentId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360
    return `<div class="avatar-fallback" style="--avatar-hue:${hue}" aria-label="${escapeHtml(student.name)}">${escapeHtml(student.name.slice(0, 2))}</div>`
  }

  function renderWinnerTicker(): string {
    if (!publicState.winners.length) {
      return `
        <section class="winner-ticker panel" aria-label="Winner list ticker">
          <div class="winner-ticker-label">中奖名单</div>
          <div class="winner-ticker-empty">当前还没有中奖学生，名单将在这里实时滚动展示。</div>
        </section>
      `
    }

    const tickerItems = publicState.winners
      .map((winner) => `
        <span class="winner-ticker-item">
          <span class="winner-ticker-avatar">${buildAvatar(winner)}</span>
          <strong>${escapeHtml(winner.name)}</strong>
          <span>${escapeHtml(winner.studentId)}</span>
          <em>${escapeHtml(winner.contestNumber ?? '')}</em>
        </span>
      `)
      .join('')

    return `
      <section class="winner-ticker panel" aria-label="Winner list ticker">
        <div class="winner-ticker-label">中奖名单</div>
        <div class="winner-ticker-marquee">
          <div class="winner-ticker-track">
            ${tickerItems}
            ${tickerItems}
          </div>
        </div>
      </section>
    `
  }

  function renderOverlay(currentStudent: StudentSession | null): string {
    if (overlayState.mode === 'register') {
      return `<div class="cinematic-overlay is-active"><video class="overlay-video" data-role="register-video" src="${registerVideoUrl}" autoplay muted preload="auto" playsinline></video></div>`
    }

    if (overlayState.mode === 'win') {
      return `
        <div class="cinematic-overlay is-active">
          <video class="overlay-video" data-role="overlay-video" src="${goldVideoUrl}" autoplay muted preload="auto" playsinline></video>
          <div class="overlay-result ${overlayState.revealResult ? 'is-visible' : ''}">
            <div class="overlay-result-card">
              <div class="overlay-avatar">${buildAvatar(overlayState.result.student)}</div>
              <p class="overlay-badge">恭喜中签</p>
              <h2 data-testid="winner-name">${escapeHtml(overlayState.result.student.name)}</h2>
              <p class="overlay-student-id">${escapeHtml(overlayState.result.student.studentId)}</p>
              <p class="overlay-number">${escapeHtml(overlayState.result.student.contestNumber ?? '')}</p>
            </div>
          </div>
        </div>
      `
    }

    if (overlayState.mode === 'lose') {
      return `
        <div class="cinematic-overlay is-active">
          <video class="overlay-video" data-role="overlay-lose-video" src="${blueVideoUrl}" autoplay muted preload="auto" playsinline></video>
          <div class="overlay-encourage ${overlayState.revealResult ? 'is-visible' : ''}">
            <div class="overlay-encourage-inner">
              <p class="overlay-badge">本次未中签</p>
              <h2>继续加油</h2>
              <p class="overlay-encourage-message">${escapeHtml(overlayState.result.message)}</p>
              <strong>剩余抽奖次数 ${currentStudent?.attemptsLeft ?? 0}</strong>
            </div>
          </div>
        </div>
      `
    }

    return '<div class="cinematic-overlay"></div>'
  }

  function renderStudentRegister(): string {
    return `
      <div class="register-page">
        ${renderWinnerTicker()}
        <section class="register-hero panel">
          <div>
            <p class="eyebrow">学生注册入口</p>
            <h1 class="hero-title">星辉参赛祈愿</h1>
            <p class="hero-desc">请先完成注册。只有后台白名单中的学号才允许注册，注册成功后也需要管理员开放抽奖才能参与。</p>
            <div class="stats-grid compact-stats">
              <article class="stat-card"><span class="stat-label">已注册人数</span><strong class="stat-value" data-testid="total-count">${publicState.summary.totalStudents}</strong></article>
              <article class="stat-card"><span class="stat-label">剩余名额</span><strong class="stat-value" data-testid="remaining-slots">${publicState.summary.remainingSlots}</strong></article>
              <article class="stat-card"><span class="stat-label">当前中签率</span><strong class="stat-value">${(publicState.summary.dynamicProbability * 100).toFixed(2)}%</strong></article>
              <article class="stat-card"><span class="stat-label">白名单人数</span><strong class="stat-value">${publicState.summary.whitelistCount}</strong></article>
            </div>
            <div class="inline-actions top-gap">
              <button type="button" class="action" data-role="goto-student-login">学生登录</button>
            </div>
          </div>
          <div class="register-card">
            <div class="section-head">
              <h2>填写注册信息</h2>
              <p>注册成功或失败都会先播放动画，再展示结果页。</p>
            </div>
            ${errorMessage ? `<p class="error-banner">${escapeHtml(errorMessage)}</p>` : ''}
            <form class="single-form" data-role="student-register-form">
              <label><span>学号</span><input name="registerStudentId" value="${escapeHtml(studentIdDraft)}" placeholder="请输入学号" required /></label>
              <label><span>密码</span><input name="registerPassword" type="password" value="${escapeHtml(studentPasswordDraft)}" placeholder="至少 6 位" required /></label>
              <label><span>姓名</span><input name="registerName" value="${escapeHtml(registerNameDraft)}" placeholder="请输入姓名" required /></label>
              <label><span>手机号码</span><input name="registerPhone" value="${escapeHtml(registerPhoneDraft)}" placeholder="请输入 11 位手机号" required /></label>
              <label>
                <span>自定义头像</span>
                <input name="registerAvatar" type="file" accept="image/*" />
                <small class="field-hint">${registerAvatarName ? `已选择：${escapeHtml(registerAvatarName)}` : '可选，支持上传 2.5MB 以内图片。'}</small>
              </label>
              <div class="inline-actions">
                <button type="submit" class="action action-primary">立即注册</button>
                <button type="button" class="action" data-role="clear-register-avatar">清空头像</button>
              </div>
            </form>
          </div>
        </section>
      </div>
    `
  }

  function renderStudentLogin(): string {
    return `
      <div class="register-page">
        <section class="register-result-shell panel">
          <p class="eyebrow">学生登录</p>
          <h1 class="hero-title">进入抽奖主页</h1>
          <p class="hero-desc">学生登录后可进入抽奖页面。若管理员尚未开放抽奖，页面会明确提示。</p>
          ${errorMessage ? `<p class="error-banner">${escapeHtml(errorMessage)}</p>` : ''}
          <form class="single-form" data-role="student-login-form">
            <label><span>学号</span><input name="loginStudentId" value="${escapeHtml(studentIdDraft)}" placeholder="请输入学号" required /></label>
            <label><span>密码</span><input name="loginPassword" type="password" value="${escapeHtml(studentPasswordDraft)}" placeholder="请输入密码" required /></label>
            <div class="inline-actions">
              <button type="submit" class="action action-primary">学生登录</button>
              <button type="button" class="action" data-role="back-to-register">返回首页</button>
            </div>
          </form>
        </section>
      </div>
    `
  }

  function renderRegisterResult(): string {
    if (registerResult.status === 'idle') {
      return ''
    }

    return `
      <div class="register-page">
        <section class="register-result-shell panel ${registerResult.status === 'success' ? 'is-success' : 'is-fail'}">
          <p class="eyebrow">${registerResult.status === 'success' ? '注册成功' : '注册失败'}</p>
          <h1 class="hero-title">${escapeHtml(registerResult.title)}</h1>
          <p class="hero-desc">${escapeHtml(registerResult.detail)}</p>
          <div class="inline-actions">
            ${registerResult.status === 'success' ? '<button type="button" class="action action-primary" data-role="goto-student-dashboard">进入抽奖主页</button>' : ''}
            <button type="button" class="action" data-role="back-to-register">返回首页</button>
          </div>
        </section>
      </div>
    `
  }

  function renderAdminLogin(): string {
    return `
      <div class="register-page">
        <section class="register-result-shell panel">
          <p class="eyebrow">管理员入口</p>
          <h1 class="hero-title">后台管理登录</h1>
          <p class="hero-desc">当前后台入口地址为 /admin。登录后可导入白名单、管理已注册用户、调整抽奖次数，并控制是否开放抽奖。</p>
          ${errorMessage ? `<p class="error-banner">${escapeHtml(errorMessage)}</p>` : ''}
          <form class="single-form" data-role="admin-login-form">
            <label><span>管理员密码</span><input name="adminPassword" type="password" value="${escapeHtml(adminPasswordDraft)}" placeholder="请输入管理员密码" /></label>
            <div class="inline-actions">
              <button type="submit" class="action action-primary">管理员登录</button>
              <button type="button" class="action" data-role="back-to-register">返回学生首页</button>
            </div>
          </form>
        </section>
      </div>
    `
  }

  function renderStudentDashboard(currentStudent: StudentSession | null): string {
    const canDraw =
      session.role === 'student' &&
      currentStudent !== null &&
      currentStudent.attemptsLeft > 0 &&
      !currentStudent.selectedAt &&
      publicState.summary.drawEnabled &&
      overlayState.mode === 'idle'

    return `
      ${renderWinnerTicker()}
      <header class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">多人在线抽签</p>
          <h1 class="hero-title">星辉参赛祈愿</h1>
          <p class="hero-desc">学生注册完成后，需要管理员先开放抽奖，才能正式开始抽签。</p>
          ${errorMessage ? `<p class="error-banner">${escapeHtml(errorMessage)}</p>` : ''}
        </div>
        <div class="stats-grid">
          <article class="stat-card"><span class="stat-label">已注册人数</span><strong class="stat-value" data-testid="total-count">${publicState.summary.totalStudents}</strong></article>
          <article class="stat-card"><span class="stat-label">已中签人数</span><strong class="stat-value" data-testid="selected-count">${publicState.summary.selectedCount}</strong></article>
          <article class="stat-card"><span class="stat-label">剩余名额</span><strong class="stat-value" data-testid="remaining-slots">${publicState.summary.remainingSlots}</strong></article>
          <article class="stat-card"><span class="stat-label">抽奖状态</span><strong class="stat-value">${publicState.summary.drawEnabled ? '已开放' : '未开放'}</strong></article>
        </div>
      </header>
      <main class="main-grid">
        <section class="panel control-panel">
          <div class="section-head">
            <h2>学生信息</h2>
            <p>当前登录学生可以查看剩余抽奖次数。是否允许抽奖由管理员控制。</p>
          </div>
          <div class="player-panel">
            ${currentStudent ? `
              <div class="player-card">
                <div class="player-avatar">${buildAvatar(currentStudent)}</div>
                <div>
                  <p class="tiny-label">当前学生</p>
                  <h3 data-testid="current-student-name">${escapeHtml(currentStudent.name)}</h3>
                  <p>${escapeHtml(currentStudent.studentId)} | ${escapeHtml(currentStudent.phoneNumber)}</p>
                  <p>剩余抽奖次数 ${currentStudent.attemptsLeft} / ${currentStudent.chances}</p>
                  <p>${currentStudent.selectedAt ? `已中签，参赛编号 ${escapeHtml(currentStudent.contestNumber ?? '')}` : publicState.summary.drawEnabled ? '抽奖已开放，可以开始。' : '抽奖暂未开放，请等待管理员开启。'}</p>
                </div>
              </div>
            ` : '<p class="empty-state">当前没有学生登录。</p>'}
          </div>
          <div class="inline-actions top-gap">
            <button type="button" class="action" data-role="student-logout">退出学生账号</button>
          </div>
        </section>
        <section class="panel stage-panel">
          <div class="section-head">
            <h2>个人抽奖舞台</h2>
            <p>只有管理员开放抽奖后，这里的按钮才会生效。</p>
          </div>
          <div class="summon-stage ${lastDraw?.outcome === 'win' ? 'is-win' : lastDraw?.outcome === 'lose' ? 'is-lose' : ''}">
            <div class="stage-backdrop"></div>
            <div class="result-card">
              ${currentStudent && lastDraw ? `
                <div class="winner-avatar">${buildAvatar(currentStudent)}</div>
                <div class="winner-copy">
                  <p class="rarity">${lastDraw.outcome === 'win' ? '恭喜中签' : '继续加油'}</p>
                  <h3>${escapeHtml(currentStudent.name)}</h3>
                  <p>${lastDraw.outcome === 'win' ? escapeHtml(currentStudent.contestNumber ?? '') : `剩余抽奖次数 ${currentStudent.attemptsLeft}`}</p>
                  <p class="draw-message">${escapeHtml(lastDraw.message)}</p>
                </div>
              ` : `
                <div class="placeholder-copy">
                  <p>${loading ? '正在同步服务端状态...' : publicState.summary.drawEnabled ? '点击下方按钮开始抽奖' : '管理员尚未开放抽奖'}</p>
                  <span>${publicState.summary.drawEnabled ? '名单和中签结果会自动刷新。' : '开放后你就可以在这里参与抽签。'}</span>
                </div>
              `}
            </div>
          </div>
          <div class="inline-actions">
            <button type="button" class="action action-primary" data-role="draw-once" ${canDraw ? '' : 'disabled'}>发起一次抽奖</button>
            <button type="button" class="action" data-role="refresh-state">立即刷新状态</button>
          </div>
          <p class="rule-note">${currentStudent ? (publicState.summary.drawEnabled ? `你当前还剩 ${currentStudent.attemptsLeft} 次机会。` : '抽奖暂未开放，请等待管理员操作。') : '请先登录。'}</p>
        </section>
      </main>
    `
  }

  function renderAdminDashboard(): string {
    return `
      <div class="admin-page">
        <header class="hero-panel">
          <div class="hero-copy">
            <p class="eyebrow">管理员后台</p>
            <h1 class="hero-title">注册与抽奖管理</h1>
            <p class="hero-desc">通过 /admin 进入后台。你可以管理白名单、查看注册用户、调整抽奖次数，并决定是否开放抽奖。</p>
            ${errorMessage ? `<p class="error-banner">${escapeHtml(errorMessage)}</p>` : ''}
          </div>
          <div class="stats-grid">
            <article class="stat-card"><span class="stat-label">白名单人数</span><strong class="stat-value">${adminState.summary.whitelistCount}</strong></article>
            <article class="stat-card"><span class="stat-label">已注册人数</span><strong class="stat-value">${adminState.summary.totalStudents}</strong></article>
            <article class="stat-card"><span class="stat-label">已中签人数</span><strong class="stat-value">${adminState.summary.selectedCount}</strong></article>
            <article class="stat-card"><span class="stat-label">中签名额</span><strong class="stat-value">${adminState.summary.winnerTarget}</strong></article>
          </div>
        </header>
        <main class="main-grid">
          <section class="panel control-panel">
            <div class="section-head">
              <h2>后台控制</h2>
              <p>每行一个学号保存白名单。开放抽奖前，学生即使注册并登录，也无法开始抽签。</p>
            </div>
            <div class="bulk-import">
              <label>
                <span>中签人数</span>
                <input data-role="winner-target-input" inputmode="numeric" value="${escapeHtml(winnerTargetDraft)}" placeholder="请输入中签人数" />
              </label>
              <div class="inline-actions">
                <button type="button" class="action" data-role="save-winner-target">保存中签名额</button>
              </div>
              <label for="allowed-ids-input">白名单学号清单</label>
              <textarea id="allowed-ids-input" data-role="allowed-ids-input" placeholder="每行一个学号">${escapeHtml(allowedIdsDraft)}</textarea>
              <div class="inline-actions">
                <button type="button" class="action ${adminState.summary.drawEnabled ? '' : 'action-primary'}" data-role="toggle-draw">${adminState.summary.drawEnabled ? '关闭抽奖' : '开放抽奖'}</button>
                <button type="button" class="action" data-role="save-allowed-ids">保存白名单</button>
                <button type="button" class="action" data-role="seed-demo">载入演示白名单</button>
                <button type="button" class="action" data-role="reset-registrations">清空注册数据</button>
                <button type="button" class="action action-danger" data-role="reset-draws">重置中签结果</button>
              </div>
            </div>
            <div class="inline-actions top-gap">
              <button type="button" class="action" data-role="admin-logout">退出管理员</button>
              <button type="button" class="action" data-role="back-to-register">返回学生首页</button>
            </div>
          </section>
          <section class="panel roster-panel">
            <div class="section-head">
              <h2>已注册用户管理</h2>
              <p>可以查看已注册用户资料，并单独调整抽奖次数。</p>
            </div>
            <div class="admin-student-list">
              ${adminState.students.length ? adminState.students.map((student) => `
                <article class="admin-student-card">
                  <div class="admin-student-main">
                    <div class="student-avatar">${buildAvatar(student)}</div>
                    <div>
                      <strong>${escapeHtml(student.name)}</strong>
                      <p>${escapeHtml(student.studentId)}</p>
                      <p>${escapeHtml(student.phoneNumber)}</p>
                      <span>${student.selectedAt ? `已中签 ${escapeHtml(student.contestNumber ?? '')}` : `剩余次数 ${student.attemptsLeft} / ${student.chances}`}</span>
                    </div>
                  </div>
                  <div class="admin-student-actions">
                    <label>
                      <span>调整抽奖次数</span>
                      <input data-role="student-chances-input" data-student-id="${escapeHtml(student.studentId)}" value="${escapeHtml(chancesDrafts[student.studentId] ?? String(student.chances))}" />
                    </label>
                    <button type="button" class="action" data-role="save-student-chances" data-student-id="${escapeHtml(student.studentId)}">保存次数</button>
                  </div>
                </article>
              `).join('') : '<p class="empty-state">当前还没有学生完成注册。</p>'}
            </div>
          </section>
        </main>
      </div>
    `
  }

  function render(): void {
    const currentStudent = session.role === 'student' ? session.student : null
    const compactShell = screen === 'student-register' || screen === 'student-login' || screen === 'register-result' || screen === 'admin-login'
    let content = ''

    if (screen === 'student-register') content = renderStudentRegister()
    if (screen === 'student-login') content = renderStudentLogin()
    if (screen === 'register-result') content = renderRegisterResult()
    if (screen === 'student-dashboard') content = renderStudentDashboard(currentStudent)
    if (screen === 'admin-login') content = renderAdminLogin()
    if (screen === 'admin-dashboard') content = renderAdminDashboard()

    root.innerHTML = `
      <div class="app-shell ${compactShell ? 'is-register-flow' : ''}">
        <div class="bg-decor" aria-hidden="true">
          <span class="bg-orb bg-orb-a"></span>
          <span class="bg-orb bg-orb-b"></span>
          <span class="bg-orb bg-orb-c"></span>
          <span class="bg-grid"></span>
          <span class="bg-particle bg-particle-a"></span>
          <span class="bg-particle bg-particle-b"></span>
          <span class="bg-particle bg-particle-c"></span>
        </div>
        ${renderOverlay(currentStudent)}
        ${content}
      </div>
    `

    hasRendered = true
    bindEvents()
  }

  function createRenderStateSignature(): string {
    return JSON.stringify({
      screen,
      session,
      publicState,
      adminSummary: adminState.summary,
      overlayState,
      registerResult,
      lastDraw,
      errorMessage,
      loading,
      pathname: window.location.pathname,
    })
  }

  function bindInputTracking(input: HTMLInputElement | HTMLTextAreaElement | null, onInput: () => void): void {
    input?.addEventListener('input', onInput)
    input?.addEventListener('focus', () => {
      suspendPollingRender = true
    })
    input?.addEventListener('blur', () => {
      suspendPollingRender = false
    })
  }

  function bindEvents(): void {
    const studentRegisterForm = root.querySelector<HTMLFormElement>('[data-role="student-register-form"]')
    const studentLoginForm = root.querySelector<HTMLFormElement>('[data-role="student-login-form"]')
    const adminLoginForm = root.querySelector<HTMLFormElement>('[data-role="admin-login-form"]')
    const clearAvatarButton = root.querySelector<HTMLButtonElement>('[data-role="clear-register-avatar"]')
    const gotoStudentLoginButton = root.querySelector<HTMLButtonElement>('[data-role="goto-student-login"]')
    const gotoStudentDashboardButton = root.querySelector<HTMLButtonElement>('[data-role="goto-student-dashboard"]')
    const backToRegisterButton = root.querySelector<HTMLButtonElement>('[data-role="back-to-register"]')
    const studentLogoutButton = root.querySelector<HTMLButtonElement>('[data-role="student-logout"]')
    const adminLogoutButton = root.querySelector<HTMLButtonElement>('[data-role="admin-logout"]')
    const drawButton = root.querySelector<HTMLButtonElement>('[data-role="draw-once"]')
    const refreshButton = root.querySelector<HTMLButtonElement>('[data-role="refresh-state"]')
    const saveAllowedIdsButton = root.querySelector<HTMLButtonElement>('[data-role="save-allowed-ids"]')
    const saveWinnerTargetButton = root.querySelector<HTMLButtonElement>('[data-role="save-winner-target"]')
    const seedButton = root.querySelector<HTMLButtonElement>('[data-role="seed-demo"]')
    const resetButton = root.querySelector<HTMLButtonElement>('[data-role="reset-draws"]')
    const resetRegistrationsButton = root.querySelector<HTMLButtonElement>('[data-role="reset-registrations"]')
    const toggleDrawButton = root.querySelector<HTMLButtonElement>('[data-role="toggle-draw"]')
    const overlayVideo = root.querySelector<HTMLVideoElement>('[data-role="overlay-video"]')
    const overlayLoseVideo = root.querySelector<HTMLVideoElement>('[data-role="overlay-lose-video"]')
    const registerVideo = root.querySelector<HTMLVideoElement>('[data-role="register-video"]')
    const registerStudentIdInput = root.querySelector<HTMLInputElement>('input[name="registerStudentId"]')
    const registerPasswordInput = root.querySelector<HTMLInputElement>('input[name="registerPassword"]')
    const registerNameInput = root.querySelector<HTMLInputElement>('input[name="registerName"]')
    const registerPhoneInput = root.querySelector<HTMLInputElement>('input[name="registerPhone"]')
    const registerAvatarInput = root.querySelector<HTMLInputElement>('input[name="registerAvatar"]')
    const loginStudentIdInput = root.querySelector<HTMLInputElement>('input[name="loginStudentId"]')
    const loginPasswordInput = root.querySelector<HTMLInputElement>('input[name="loginPassword"]')
    const adminPasswordInput = root.querySelector<HTMLInputElement>('input[name="adminPassword"]')
    const winnerTargetInput = root.querySelector<HTMLInputElement>('[data-role="winner-target-input"]')
    const allowedIdsInput = root.querySelector<HTMLTextAreaElement>('[data-role="allowed-ids-input"]')
    const chancesInputs = root.querySelectorAll<HTMLInputElement>('[data-role="student-chances-input"]')
    const saveChancesButtons = root.querySelectorAll<HTMLButtonElement>('[data-role="save-student-chances"]')

    bindInputTracking(registerStudentIdInput, () => { studentIdDraft = registerStudentIdInput?.value ?? '' })
    bindInputTracking(registerPasswordInput, () => { studentPasswordDraft = registerPasswordInput?.value ?? '' })
    bindInputTracking(registerNameInput, () => { registerNameDraft = registerNameInput?.value ?? '' })
    bindInputTracking(registerPhoneInput, () => { registerPhoneDraft = registerPhoneInput?.value ?? '' })
    bindInputTracking(loginStudentIdInput, () => { studentIdDraft = loginStudentIdInput?.value ?? '' })
    bindInputTracking(loginPasswordInput, () => { studentPasswordDraft = loginPasswordInput?.value ?? '' })
    bindInputTracking(adminPasswordInput, () => { adminPasswordDraft = adminPasswordInput?.value ?? '' })
    bindInputTracking(winnerTargetInput, () => { winnerTargetDraft = winnerTargetInput?.value ?? '' })
    bindInputTracking(allowedIdsInput, () => { allowedIdsDraft = allowedIdsInput?.value ?? '' })
    chancesInputs.forEach((input) => bindInputTracking(input, () => { chancesDrafts[input.dataset.studentId ?? ''] = input.value }))

    gotoStudentLoginButton?.addEventListener('click', () => {
      errorMessage = ''
      screen = 'student-login'
      render()
    })

    gotoStudentDashboardButton?.addEventListener('click', () => {
      registerResult = { status: 'idle' }
      screen = 'student-dashboard'
      render()
    })

    backToRegisterButton?.addEventListener('click', () => {
      registerResult = { status: 'idle' }
      errorMessage = ''
      window.history.pushState({}, '', '/')
      screen = 'student-register'
      render()
    })

    registerAvatarInput?.addEventListener('change', async () => {
      const file = registerAvatarInput.files?.[0]
      if (!file) {
        registerAvatarDraft = ''
        registerAvatarName = ''
        render()
        return
      }

      registerAvatarName = file.name
      try {
        registerAvatarDraft = await readFileAsDataUrl(file)
        errorMessage = ''
      } catch {
        registerAvatarDraft = ''
        registerAvatarName = ''
        errorMessage = '无法读取所选头像文件。'
      }
      render()
    })

    clearAvatarButton?.addEventListener('click', () => {
      registerAvatarDraft = ''
      registerAvatarName = ''
      if (registerAvatarInput) registerAvatarInput.value = ''
      render()
    })

    studentRegisterForm?.addEventListener('submit', async (event) => {
      event.preventDefault()
      try {
        const response = await apiPost<{ token: string; student: StudentSession; state: PublicState }>('/api/auth/student/register', {
          studentId: studentIdDraft,
          password: studentPasswordDraft,
          name: registerNameDraft,
          phoneNumber: registerPhoneDraft,
          avatarUrl: registerAvatarDraft,
        })

        session = { role: 'student', token: response.token, student: response.student }
        saveToken(response.token)
        publicState = response.state
        registerResult = {
          status: 'success',
          title: '注册成功',
          detail: '账号已经创建完成。请等待管理员开放抽奖后，再进入抽奖页面参与抽签。',
        }
        overlayState = { mode: 'register' }
        screen = 'register-result'
        errorMessage = ''
        render()
      } catch (error) {
        registerResult = { status: 'fail', title: '注册失败', detail: getErrorMessage(error) }
        overlayState = { mode: 'register' }
        screen = 'register-result'
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    studentLoginForm?.addEventListener('submit', async (event) => {
      event.preventDefault()
      try {
        const response = await apiPost<{ token: string; student: StudentSession }>('/api/auth/student/login', {
          studentId: studentIdDraft,
          password: studentPasswordDraft,
        })
        session = { role: 'student', token: response.token, student: response.student }
        saveToken(response.token)
        registerResult = { status: 'idle' }
        screen = 'student-dashboard'
        errorMessage = ''
        await refreshPublicAndSession(true)
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    adminLoginForm?.addEventListener('submit', async (event) => {
      event.preventDefault()
      try {
        const response = await apiPost<{ token: string }>('/api/auth/admin/login', { password: adminPasswordDraft })
        session = { role: 'admin', token: response.token }
        saveToken(response.token)
        window.history.pushState({}, '', '/admin')
        await refreshAdminState()
        screen = 'admin-dashboard'
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    studentLogoutButton?.addEventListener('click', async () => {
      await logout('/')
    })

    adminLogoutButton?.addEventListener('click', async () => {
      await logout('/admin')
    })

    drawButton?.addEventListener('click', async () => {
      if (session.role !== 'student') return
      try {
        const response = await apiPost<{ result: DrawResult; state: PublicState; me: { student: StudentSession } }>('/api/draw', {}, session.token)
        lastDraw = response.result
        publicState = response.state
        session = { role: 'student', token: session.token, student: response.me.student }
        overlayState = response.result.outcome === 'win'
          ? { mode: 'win', result: response.result, revealResult: false }
          : { mode: 'lose', result: response.result, revealResult: false }
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    refreshButton?.addEventListener('click', () => {
      void refreshPublicAndSession(true)
    })

    saveAllowedIdsButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') return
      try {
        await apiPost('/api/admin/allowed-student-ids', { raw: allowedIdsDraft }, session.token)
        await refreshAdminState()
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    saveWinnerTargetButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') return
      try {
        adminState = await apiPost<AdminState>('/api/admin/winner-target', { winnerTarget: winnerTargetDraft }, session.token)
        winnerTargetDraft = String(adminState.summary.winnerTarget)
        allowedIdsDraft = adminState.allowedStudentIds.join('\n')
        chancesDrafts = Object.fromEntries(adminState.students.map((student) => [student.studentId, String(student.chances)]))
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    seedButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') return
      try {
        await apiPost('/api/admin/seed', {}, session.token)
        await refreshAdminState()
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    resetRegistrationsButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') return
      try {
        await apiPost('/api/admin/reset-registrations', {}, session.token)
        await refreshAdminState()
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    resetButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') return
      try {
        await apiPost('/api/admin/reset', {}, session.token)
        await refreshAdminState()
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    toggleDrawButton?.addEventListener('click', async () => {
      if (session.role !== 'admin') return
      try {
        adminState = await apiPost<AdminState>('/api/admin/draw-toggle', { enabled: !adminState.summary.drawEnabled }, session.token)
        allowedIdsDraft = adminState.allowedStudentIds.join('\n')
        errorMessage = ''
        render()
      } catch (error) {
        errorMessage = getErrorMessage(error)
        render()
      }
    })

    saveChancesButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        if (session.role !== 'admin') return
        const studentId = button.dataset.studentId ?? ''
        try {
          const response = await apiPost<{ state: AdminState }>('/api/admin/students/chances', { studentId, chances: chancesDrafts[studentId] ?? '' }, session.token)
          adminState = response.state
          allowedIdsDraft = adminState.allowedStudentIds.join('\n')
          chancesDrafts = Object.fromEntries(adminState.students.map((student) => [student.studentId, String(student.chances)]))
          errorMessage = ''
          render()
        } catch (error) {
          errorMessage = getErrorMessage(error)
          render()
        }
      })
    })

    overlayVideo?.addEventListener('ended', () => {
      if (overlayState.mode !== 'win') return
      overlayState = { ...overlayState, revealResult: true }
      render()
      window.setTimeout(() => {
        overlayState = { mode: 'idle' }
        void refreshPublicAndSession()
        render()
      }, 4600)
    })

    overlayLoseVideo?.addEventListener('ended', () => {
      if (overlayState.mode !== 'lose') return
      overlayState = { ...overlayState, revealResult: true }
      render()
      window.setTimeout(() => {
        overlayState = { mode: 'idle' }
        void refreshPublicAndSession()
        render()
      }, 3800)
    })

    registerVideo?.addEventListener('ended', () => {
      if (overlayState.mode !== 'register') return
      overlayState = { mode: 'idle' }
      render()
    })
  }

  async function logout(pathname: '/' | '/admin'): Promise<void> {
    if (session.token) {
      await apiPost('/api/auth/logout', {}, session.token).catch(() => undefined)
    }
    session = { role: 'guest', token: null }
    clearToken()
    registerResult = { status: 'idle' }
    lastDraw = null
    window.history.pushState({}, '', pathname)
    screen = pathname === '/admin' ? 'admin-login' : 'student-register'
    await refreshPublicAndSession(true)
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('头像文件读取失败。'))
    reader.onerror = () => reject(reader.error ?? new Error('头像文件读取失败。'))
    reader.readAsDataURL(file)
  })
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
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
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
    throw new Error(typeof data.error === 'string' ? data.error : '请求失败。')
  }
  return data as T
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。'
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
