import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, 'server-db.json')
const PORT = 4174
const WINNER_TARGET = 35
const DEFAULT_CHANCES = 10
const ADMIN_PASSWORD = 'admin2026'

const FAMILY_NAMES = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许']
const GIVEN_NAMES = ['子涵', '雨桐', '宇轩', '思远', '嘉宁', '晨曦', '梓航', '可欣', '浩然', '芷晴', '昊天', '一诺', '书瑶', '嘉懿', '奕辰', '俊熙', '清妍', '沐宸', '知夏', '星野']

const ENCOURAGEMENT_MESSAGES = [
  '这次星轨偏了一点点，下次更接近金光。',
  '今天的运气正在蓄力，继续加油。',
  '差一点点，下一抽说不定就会闪耀。',
  '星辉还在汇聚，别急，继续冲。',
]

const sessions = new Map()

function createSampleStudents(count = 240) {
  return Array.from({ length: count }, (_, index) => {
    const serial = String(index + 1).padStart(4, '0')
    const studentId = `2026${serial}`
    return {
      id: crypto.randomUUID(),
      name: `${FAMILY_NAMES[index % FAMILY_NAMES.length]}${GIVEN_NAMES[(index * 7) % GIVEN_NAMES.length]}`,
      studentId,
      password: studentId.slice(-6),
      avatarUrl: '',
      chances: DEFAULT_CHANCES,
      attemptsUsed: 0,
      selectedAt: null,
      contestNumber: null,
    }
  })
}

function seedDb() {
  return {
    students: createSampleStudents(240),
  }
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = seedDb()
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2))
    return initial
  }

  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

function sanitizeStudent(student) {
  const { password, ...safe } = student
  return safe
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

function getRemainingSlots(db) {
  return Math.max(0, WINNER_TARGET - getSelectedStudents(db).length)
}

function getRemainingAttemptPool(db) {
  return getRemainingStudents(db).reduce((sum, student) => sum + getAttemptsLeft(student), 0)
}

function getDynamicProbability(db) {
  const remainingSlots = getRemainingSlots(db)
  const remainingAttemptPool = getRemainingAttemptPool(db)
  if (remainingSlots <= 0 || remainingAttemptPool <= 0) {
    return 0
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
      remainingSlots: getRemainingSlots(db),
      dynamicProbability: getDynamicProbability(db),
      remainingStudents: getRemainingStudents(db).length,
    },
    winners: getSelectedStudents(db).map(sanitizeStudent),
    rosterPreview: db.students.slice(0, 120).map(sanitizeStudent),
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

function drawForStudent(db, student) {
  if (student.selectedAt !== null || getAttemptsLeft(student) <= 0 || getRemainingSlots(db) <= 0) {
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
      message: '金光降临，恭喜你获得参赛资格。',
    }
  }

  return {
    outcome: 'lose',
    student: sanitizeStudent(student),
    probability,
    message: ENCOURAGEMENT_MESSAGES[student.attemptsUsed % ENCOURAGEMENT_MESSAGES.length],
  }
}

function resetDraws(db) {
  db.students = db.students.map((student) => ({
    ...student,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
  }))
}

function addStudent(db, payload) {
  const studentId = String(payload.studentId ?? '').trim()
  const name = String(payload.name ?? '').trim()
  const avatarUrl = String(payload.avatarUrl ?? '').trim()

  if (!studentId || !name) {
    return null
  }

  const student = {
    id: crypto.randomUUID(),
    name,
    studentId,
    password: studentId.slice(-6),
    avatarUrl,
    chances: DEFAULT_CHANCES,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
  }

  db.students.unshift(student)
  return sanitizeStudent(student)
}

function parseBulkInput(raw) {
  return String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,/).map((item) => item.trim())
      return { name: parts[0] ?? '', studentId: parts[1] ?? '', avatarUrl: parts[2] ?? '' }
    })
    .filter((item) => item.name && item.studentId)
}

const app = express()
app.use(express.json({ limit: '1mb' }))

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
  const db = loadDb()
  res.json(getPublicState(db))
})

app.get('/api/me', (req, res) => {
  const db = loadDb()
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

app.post('/api/auth/student/login', (req, res) => {
  const db = loadDb()
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

app.post('/api/draw', (req, res) => {
  const db = loadDb()
  const student = requireStudent(req, res, db)
  if (!student) {
    return
  }

  const result = drawForStudent(db, student)
  if (!result) {
    res.status(400).json({ error: 'Student cannot draw right now.' })
    return
  }

  saveDb(db)
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

app.post('/api/admin/students', (req, res) => {
  const db = loadDb()
  if (!requireAdmin(req, res)) {
    return
  }

  const added = addStudent(db, req.body)
  if (!added) {
    res.status(400).json({ error: 'Invalid student payload.' })
    return
  }

  saveDb(db)
  res.json({ student: added, state: getPublicState(db) })
})

app.post('/api/admin/bulk-import', (req, res) => {
  const db = loadDb()
  if (!requireAdmin(req, res)) {
    return
  }

  const rows = parseBulkInput(req.body.raw)
  const students = rows.map((item) => addStudent(db, item)).filter(Boolean)
  saveDb(db)
  res.json({ count: students.length, state: getPublicState(db) })
})

app.post('/api/admin/seed', (req, res) => {
  if (!requireAdmin(req, res)) {
    return
  }

  const db = { students: createSampleStudents(240) }
  saveDb(db)
  res.json({ state: getPublicState(db) })
})

app.post('/api/admin/reset', (req, res) => {
  const db = loadDb()
  if (!requireAdmin(req, res)) {
    return
  }

  resetDraws(db)
  saveDb(db)
  res.json({ state: getPublicState(db) })
})

app.listen(PORT, () => {
  console.log(`Lottery server running at http://127.0.0.1:${PORT}`)
})
