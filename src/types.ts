export type Student = {
  id: string
  name: string
  studentId: string
  phoneNumber: string
  avatarUrl: string
  chances: number
  attemptsUsed: number
  selectedAt: number | null
  contestNumber: string | null
}

export type DrawResult = {
  outcome: 'win' | 'lose'
  student: Student
  remainingStudents: number
  remainingSlots: number
  probability: number
  message: string
}

export type AppState = {
  students: Student[]
  lastWinnerId: string | null
  currentStudentId: string | null
}
