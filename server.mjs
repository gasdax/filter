import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.join(__dirname, 'server-db.json')
const PORT = 4174
const DEFAULT_WINNER_TARGET = 35
const DEFAULT_CHANCES = 20
const ADMIN_PASSWORD = 'admin2026'
const WIN_MESSAGES = [
  '恭喜你成功中签，舞台正在为你点亮。',
  '好运降临，恭喜你拿到了本次中签名额。',
  '这一抽梦想成真，恭喜你成功入选。',
]
const LOSE_MESSAGES = [
  '别灰心，幸运可能就在下一次转角等你。',
  '这次先蓄力，下一抽继续发光。',
  '保持好手气，下一次也许就是你的高光时刻。',
  '离幸运又近了一步，继续加油。',
]

const sessions = new Map()
let db = null
let saveTimer = null
let saveInFlight = Promise.resolve()
let mutationQueue = Promise.resolve()

function createAllowedStudentIds(count = 240) {
  return Array.from({ length: count }, (_, index) => `2026${String(index + 1).padStart(4, '0')}`)
}

function seedDb() {
  return {
    allowedStudentIds: createAllowedStudentIds(),
    drawEnabled: false,
    winnerTarget: DEFAULT_WINNER_TARGET,
    students: [],
  }
}

function normalizeDbShape(raw) {
  if (raw && Array.isArray(raw.allowedStudentIds) && Array.isArray(raw.students)) {
    return {
      allowedStudentIds: [...new Set(raw.allowedStudentIds.map((item) => String(item).trim()).filter(Boolean))],
      drawEnabled: Boolean(raw.drawEnabled),
      winnerTarget: normalizeWinnerTarget(raw.winnerTarget),
      students: raw.students.map(normalizeStudentRecord).filter(Boolean),
    }
  }

  if (raw && Array.isArray(raw.students)) {
    return {
      allowedStudentIds: [...new Set(raw.students.map((student) => String(student.studentId ?? '').trim()).filter(Boolean))],
      drawEnabled: false,
      winnerTarget: DEFAULT_WINNER_TARGET,
      students: raw.students.map(normalizeStudentRecord).filter(Boolean),
    }
  }

  return seedDb()
}

function normalizeStudentRecord(student) {
  const studentId = String(student?.studentId ?? '').trim()
  const password = String(student?.password ?? '').trim()
  const name = String(student?.name ?? '').trim()

  if (!studentId || !password || !name) {
    return null
  }

  return {
    id: String(student.id ?? crypto.randomUUID()),
    name,
    studentId,
    password,
    phoneNumber: String(student.phoneNumber ?? ''),
    avatarUrl: String(student.avatarUrl ?? ''),
    chances: Number(student.chances ?? DEFAULT_CHANCES) || DEFAULT_CHANCES,
    attemptsUsed: Number(student.attemptsUsed ?? 0) || 0,
    selectedAt: student.selectedAt === null || student.selectedAt === undefined ? null : Number(student.selectedAt),
    contestNumber: student.contestNumber ? String(student.contestNumber) : null,
    registeredAt: Number(student.registeredAt ?? Date.now()),
  }
}

function loadDbFromDisk() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = seedDb()
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2))
    return initial
  }

  const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  const normalized = normalizeDbShape(parsed)
  fs.writeFileSync(DB_PATH, JSON.stringify(normalized, null, 2))
  return normalized
}

function scheduleSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    const snapshot = JSON.stringify(db, null, 2)
    saveInFlight = saveInFlight
      .catch(() => undefined)
      .then(() => fsp.writeFile(DB_PATH, snapshot))
      .catch((error) => {
        console.error('Failed to persist lottery data:', error)
      })
  }, 50)
}

function runMutation(task) {
  const run = mutationQueue.then(async () => task())
  mutationQueue = run.catch(() => undefined)
  return run
}

function sanitizeStudent(student) {
  const { password, ...safe } = student
  return safe
}

function getRegisteredStudents(db) {
  return [...db.students].sort((left, right) => left.registeredAt - right.registeredAt)
}

function getSelectedStudents(db) {
  return [...db.students]
    .filter((student) => student.selectedAt !== null)
    .sort((left, right) => left.selectedAt - right.selectedAt)
}

function getRemainingStudents(db) {
  return db.students.filter((student) => student.selectedAt === null)
}

function getAttemptsLeft(student) {
  return Math.max(0, student.chances - student.attemptsUsed)
}

function pickRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)]
}

function normalizeWinnerTarget(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized < 1) {
    return DEFAULT_WINNER_TARGET
  }

  return Math.floor(normalized)
}

function getRemainingSlots(db) {
  return Math.max(0, db.winnerTarget - getSelectedStudents(db).length)
}

function getRemainingAttemptPool(db) {
  return getRemainingStudents(db).reduce((sum, student) => sum + getAttemptsLeft(student), 0)
}

function getDynamicProbability(db) {
  const registeredCount = db.students.length
  const remainingSlots = getRemainingSlots(db)
  const remainingAttemptPool = getRemainingAttemptPool(db)

  if (remainingSlots <= 0 || remainingAttemptPool <= 0 || registeredCount === 0) {
    return 0
  }

  if (registeredCount <= db.winnerTarget) {
    return 1
  }

  return Math.min(1, remainingSlots / remainingAttemptPool)
}

function createContestNumber(order) {
  return `NO.${String(order).padStart(2, '0')}`
}

function getPublicState(db) {
  return {
    summary: {
      totalStudents: db.students.length,
      selectedCount: getSelectedStudents(db).length,
      winnerTarget: db.winnerTarget,
      remainingSlots: getRemainingSlots(db),
      dynamicProbability: getDynamicProbability(db),
      remainingStudents: getRemainingStudents(db).length,
      whitelistCount: db.allowedStudentIds.length,
      drawEnabled: db.drawEnabled,
    },
    winners: getSelectedStudents(db).map(sanitizeStudent),
    rosterPreview: getRegisteredStudents(db).slice(0, 120).map(sanitizeStudent),
  }
}

function getAdminState(db) {
  return {
    summary: getPublicState(db).summary,
    allowedStudentIds: db.allowedStudentIds,
    students: getRegisteredStudents(db).map((student) => ({
      ...sanitizeStudent(student),
      attemptsLeft: getAttemptsLeft(student),
    })),
  }
}

function createToken(payload) {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, payload)
  return token
}

function getSession(req) {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) {
    return null
  }

  const session = sessions.get(token)
  return session ? { token, ...session } : null
}

function requireAdmin(req, res) {
  const session = getSession(req)
  if (!session || session.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' })
    return null
  }

  return session
}

function requireStudent(req, res, db) {
  const session = getSession(req)
  if (!session || session.role !== 'student') {
    res.status(403).json({ error: 'Student access required.' })
    return null
  }

  const student = db.students.find((item) => item.studentId === session.studentId)
  if (!student) {
    res.status(404).json({ error: 'Student not found.' })
    return null
  }

  return student
}

function isValidPhoneNumber(phoneNumber) {
  return /^1\d{10}$/.test(phoneNumber)
}

function validateAvatarUrl(avatarUrl) {
  if (!avatarUrl) {
    return true
  }

  if (avatarUrl.startsWith('data:image/')) {
    return avatarUrl.length <= 2_500_000
  }

  try {
    const url = new URL(avatarUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function registerStudent(db, payload) {
  const studentId = String(payload.studentId ?? '').trim()
  const password = String(payload.password ?? '').trim()
  const name = String(payload.name ?? '').trim()
  const phoneNumber = String(payload.phoneNumber ?? '').trim()
  const avatarUrl = String(payload.avatarUrl ?? '').trim()

  if (!studentId || !password || !name || !phoneNumber) {
    return { error: 'Please complete all registration fields.' }
  }

  if (!db.allowedStudentIds.includes(studentId)) {
    return { error: 'This student ID is not in the allowed registration list.' }
  }

  if (db.students.some((student) => student.studentId === studentId)) {
    return { error: 'This student ID has already been registered.' }
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  if (!isValidPhoneNumber(phoneNumber)) {
    return { error: 'Phone number must be an 11-digit mobile number.' }
  }

  if (!validateAvatarUrl(avatarUrl)) {
    return { error: 'Avatar must be an image URL or an uploaded image under 2.5MB.' }
  }

  const student = {
    id: crypto.randomUUID(),
    name,
    studentId,
    password,
    phoneNumber,
    avatarUrl,
    chances: DEFAULT_CHANCES,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
    registeredAt: Date.now(),
  }

  db.students.push(student)
  return { student }
}

function drawForStudent(db, student) {
  if (!db.drawEnabled || student.selectedAt !== null || getAttemptsLeft(student) <= 0 || getRemainingSlots(db) <= 0) {
    return null
  }

  const probability = getDynamicProbability(db)
  student.attemptsUsed += 1

  if (Math.random() < probability) {
    const order = getSelectedStudents(db).length + 1
    student.selectedAt = order
    student.contestNumber = createContestNumber(order)

    return {
      outcome: 'win',
      student: sanitizeStudent(student),
      probability,
      message: pickRandomMessage(WIN_MESSAGES),
    }
  }

  return {
    outcome: 'lose',
    student: sanitizeStudent(student),
    probability,
    message: pickRandomMessage(LOSE_MESSAGES),
  }
}

function resetDraws(db) {
  db.students = db.students.map((student) => ({
    ...student,
    chances: DEFAULT_CHANCES,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
  }))
}

function setDrawEnabled(db, enabled) {
  db.drawEnabled = Boolean(enabled)
}

function updateWinnerTarget(db, winnerTarget) {
  const normalized = Number(winnerTarget)
  const selectedCount = getSelectedStudents(db).length

  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 999) {
    return { error: 'Winner target must be a number between 1 and 999.' }
  }

  const nextTarget = Math.floor(normalized)
  if (nextTarget < selectedCount) {
    return { error: `Winner target cannot be less than the current selected count (${selectedCount}).` }
  }

  db.winnerTarget = nextTarget
  return { ok: true }
}

function resetAllRegistrations(db) {
  db.students = []
}

function setAllowedStudentIds(db, raw) {
  const ids = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  db.allowedStudentIds = [...new Set(ids)]
}

function updateStudentChances(db, studentId, chances) {
  const student = db.students.find((item) => item.studentId === studentId)
  if (!student) {
    return { error: 'Student not found.' }
  }

  const normalized = Number(chances)
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 999) {
    return { error: 'Chances must be a number between 0 and 999.' }
  }

  student.chances = Math.floor(normalized)
  student.attemptsUsed = Math.min(student.attemptsUsed, student.chances)

  return {
    student: {
      ...sanitizeStudent(student),
      attemptsLeft: getAttemptsLeft(student),
    },
  }
}

const app = express()
app.use(express.json({ limit: '5mb' }))

app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  next()
})

app.options(/.*/, (_, res) => {
  res.sendStatus(204)
})

app.get('/api/health', (_, res) => {
  res.json({ ok: true })
})

app.get('/api/public/state', (_, res) => {
  res.json(getPublicState(db))
})

app.get('/api/me', (req, res) => {
  const session = getSession(req)
  if (!session) {
    res.json({ role: 'guest' })
    return
  }

  if (session.role === 'admin') {
    res.json({ role: 'admin' })
    return
  }

  const student = db.students.find((item) => item.studentId === session.studentId)
  if (!student) {
    res.json({ role: 'guest' })
    return
  }

  res.json({
    role: 'student',
    student: {
      ...sanitizeStudent(student),
      attemptsLeft: getAttemptsLeft(student),
    },
  })
})

app.post('/api/auth/student/register', async (req, res) => {
  await runMutation(async () => {
    const registration = registerStudent(db, req.body)

    if (registration.error) {
      res.status(400).json({ error: registration.error, state: getPublicState(db) })
      return
    }

    scheduleSave()
    const token = createToken({ role: 'student', studentId: registration.student.studentId })
    res.json({
      token,
      role: 'student',
      student: {
        ...sanitizeStudent(registration.student),
        attemptsLeft: getAttemptsLeft(registration.student),
      },
      state: getPublicState(db),
    })
  })
})

app.post('/api/auth/student/login', (req, res) => {
  const studentId = String(req.body.studentId ?? '').trim()
  const password = String(req.body.password ?? '').trim()
  const student = db.students.find((item) => item.studentId === studentId)

  if (!student || student.password !== password) {
    res.status(401).json({ error: 'Invalid student credentials.' })
    return
  }

  const token = createToken({ role: 'student', studentId })
  res.json({
    token,
    role: 'student',
    student: {
      ...sanitizeStudent(student),
      attemptsLeft: getAttemptsLeft(student),
    },
  })
})

app.post('/api/auth/admin/login', (req, res) => {
  const password = String(req.body.password ?? '').trim()
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin password.' })
    return
  }

  const token = createToken({ role: 'admin' })
  res.json({ token, role: 'admin' })
})

app.post('/api/auth/logout', (req, res) => {
  const session = getSession(req)
  if (session) {
    sessions.delete(session.token)
  }

  res.json({ ok: true })
})

app.post('/api/draw', async (req, res) => {
  await runMutation(async () => {
    const student = requireStudent(req, res, db)
    if (!student) {
      return
    }

    if (!db.drawEnabled) {
      res.status(400).json({ error: 'Draw has not been opened by the admin yet.' })
      return
    }

    const result = drawForStudent(db, student)
    if (!result) {
      res.status(400).json({ error: 'Student cannot draw right now.' })
      return
    }

    scheduleSave()
    res.json({
      result,
      state: getPublicState(db),
      me: {
        role: 'student',
        student: {
          ...sanitizeStudent(student),
          attemptsLeft: getAttemptsLeft(student),
        },
      },
    })
  })
})

app.post('/api/admin/allowed-student-ids', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    setAllowedStudentIds(db, req.body.raw)
    db.students = db.students.filter((student) => db.allowedStudentIds.includes(student.studentId))
    resetDraws(db)
    scheduleSave()

    res.json({
      state: getPublicState(db),
      allowedStudentIds: db.allowedStudentIds,
    })
  })
})

app.get('/api/admin/allowed-student-ids', (req, res) => {
  if (!requireAdmin(req, res)) {
    return
  }

  res.json({ allowedStudentIds: db.allowedStudentIds })
})

app.get('/api/admin/state', (req, res) => {
  if (!requireAdmin(req, res)) {
    return
  }

  res.json(getAdminState(db))
})

app.post('/api/admin/draw-toggle', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    setDrawEnabled(db, req.body.enabled)
    scheduleSave()
    res.json(getAdminState(db))
  })
})

app.post('/api/admin/students/chances', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    const studentId = String(req.body.studentId ?? '').trim()
    const chances = req.body.chances
    const result = updateStudentChances(db, studentId, chances)

    if (result.error) {
      res.status(400).json({ error: result.error })
      return
    }

    scheduleSave()
    res.json({
      student: result.student,
      state: getAdminState(db),
    })
  })
})

app.post('/api/admin/winner-target', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    const result = updateWinnerTarget(db, req.body.winnerTarget)
    if (result.error) {
      res.status(400).json({ error: result.error })
      return
    }

    scheduleSave()
    res.json(getAdminState(db))
  })
})

app.post('/api/admin/seed', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    db = seedDb()
    scheduleSave()
    res.json({
      state: getPublicState(db),
      allowedStudentIds: db.allowedStudentIds,
    })
  })
})

app.post('/api/admin/reset', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    resetDraws(db)
    scheduleSave()
    res.json({ state: getPublicState(db) })
  })
})

app.post('/api/admin/reset-registrations', async (req, res) => {
  await runMutation(async () => {
    if (!requireAdmin(req, res)) {
      return
    }

    resetAllRegistrations(db)
    scheduleSave()
    res.json({ state: getPublicState(db) })
  })
})

db = loadDbFromDisk()

app.listen(PORT, () => {
  console.log(`Lottery server running at http://127.0.0.1:${PORT}`)
})
