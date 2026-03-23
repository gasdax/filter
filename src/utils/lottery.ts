import type { DrawResult, Student } from '../types'

export const WINNER_TARGET = 35
export const DEFAULT_CHANCES = 20

const ENCOURAGEMENT_MESSAGES = [
  '这次星轨偏了一点点，下次更接近金光。',
  '今天的运气正在蓄力，继续加油。',
  '差一点点，下一抽说不定就会闪耀。',
  '星辉还在汇聚，别急，继续冲。',
]

export function normalizeStudent(input: {
  name: string
  studentId: string
  phoneNumber: string
  avatarUrl?: string
}): Student {
  const name = input.name.trim()
  const studentId = input.studentId.trim()

  return {
    id: `${studentId}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    studentId,
    phoneNumber: input.phoneNumber.trim(),
    avatarUrl: input.avatarUrl?.trim() ?? '',
    chances: DEFAULT_CHANCES,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
  }
}

export function getSelectedStudents(students: Student[]): Student[] {
  return [...students]
    .filter((student) => student.selectedAt !== null)
    .sort((left, right) => (left.selectedAt ?? 0) - (right.selectedAt ?? 0))
}

export function getRemainingStudents(students: Student[]): Student[] {
  return students.filter((student) => student.selectedAt === null)
}

export function getAttemptsLeft(student: Student): number {
  return Math.max(0, student.chances - student.attemptsUsed)
}

export function getRemainingSlots(students: Student[]): number {
  return Math.max(0, WINNER_TARGET - getSelectedStudents(students).length)
}

export function getRemainingAttemptPool(students: Student[]): number {
  return getRemainingStudents(students).reduce((sum, student) => sum + getAttemptsLeft(student), 0)
}

export function findStudentByStudentId(students: Student[], studentId: string): Student | null {
  return students.find((student) => student.studentId === studentId.trim()) ?? null
}

export function canStudentDraw(student: Student | null, students: Student[]): boolean {
  if (!student) {
    return false
  }

  if (student.selectedAt !== null) {
    return false
  }

  if (getAttemptsLeft(student) <= 0) {
    return false
  }

  return getRemainingSlots(students) > 0
}

export function getDynamicProbability(students: Student[]): number {
  if (students.length <= WINNER_TARGET && students.length > 0) {
    return 1
  }

  const remainingSlots = getRemainingSlots(students)
  const remainingAttemptPool = getRemainingAttemptPool(students)

  if (remainingSlots <= 0 || remainingAttemptPool <= 0) {
    return 0
  }

  return Math.min(1, remainingSlots / remainingAttemptPool)
}

export function drawForStudent(
  students: Student[],
  studentId: string,
  randomValue = Math.random(),
): DrawResult | null {
  const student = findStudentByStudentId(students, studentId)

  if (!canStudentDraw(student, students) || !student) {
    return null
  }

  const probability = getDynamicProbability(students)
  student.attemptsUsed += 1

  const didWin = randomValue < probability
  if (didWin) {
    const drawOrder = getSelectedStudents(students).length + 1
    student.selectedAt = drawOrder
    student.contestNumber = `NO.${String(drawOrder).padStart(2, '0')}`

    return {
      outcome: 'win',
      student,
      remainingStudents: getRemainingStudents(students).length,
      remainingSlots: getRemainingSlots(students),
      probability,
      message: '金光降临，恭喜你获得参赛资格。',
    }
  }

  return {
    outcome: 'lose',
    student,
    remainingStudents: getRemainingStudents(students).length,
    remainingSlots: getRemainingSlots(students),
    probability,
    message: ENCOURAGEMENT_MESSAGES[student.attemptsUsed % ENCOURAGEMENT_MESSAGES.length] ?? ENCOURAGEMENT_MESSAGES[0],
  }
}

export function resetSelections(students: Student[]): Student[] {
  return students.map((student) => ({
    ...student,
    attemptsUsed: 0,
    selectedAt: null,
    contestNumber: null,
  }))
}

export function parseBulkInput(raw: string): Array<{ name: string; studentId: string; avatarUrl?: string }> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,/).map((item) => item.trim())
      return {
        name: parts[0] ?? '',
        studentId: parts[1] ?? '',
        avatarUrl: parts[2] ?? '',
      }
    })
    .filter((item) => item.name && item.studentId)
}

export function parseStudentIdLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
