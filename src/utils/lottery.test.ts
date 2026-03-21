import { describe, expect, it } from 'vitest'
import { createSampleStudents } from '../data/sampleStudents'
import {
  DEFAULT_CHANCES,
  WINNER_TARGET,
  drawForStudent,
  findStudentByStudentId,
  getAttemptsLeft,
  getDynamicProbability,
  getRemainingSlots,
  getSelectedStudents,
  parseBulkInput,
  resetSelections,
} from './lottery'

describe('lottery utils', () => {
  it('computes a dynamic probability from remaining slots and attempts', () => {
    const students = createSampleStudents(100)
    expect(getDynamicProbability(students)).toBe(WINNER_TARGET / (100 * DEFAULT_CHANCES))
  })

  it('lets a student win and receive a contest number', () => {
    const students = createSampleStudents(40)
    const firstStudent = students[0]

    const result = drawForStudent(students, firstStudent.studentId, 0)

    expect(result?.outcome).toBe('win')
    expect(result?.student.contestNumber).toBe('NO.01')
    expect(getSelectedStudents(students)).toHaveLength(1)
  })

  it('consumes an attempt on a loss', () => {
    const students = createSampleStudents(100)
    const firstStudent = students[0]
    const probability = getDynamicProbability(students)

    const result = drawForStudent(students, firstStudent.studentId, Math.min(0.999, probability + 0.1))

    expect(result?.outcome).toBe('lose')
    expect(getAttemptsLeft(firstStudent)).toBe(DEFAULT_CHANCES - 1)
    expect(getRemainingSlots(students)).toBe(WINNER_TARGET)
  })

  it('parses bulk input lines with comma or tab', () => {
    const result = parseBulkInput('张三,20260001\n李四\t20260002\thttps://example.com/a.png')
    expect(result).toHaveLength(2)
    expect(result[1]?.avatarUrl).toContain('example.com')
  })

  it('resets selections and attempts cleanly', () => {
    const students = createSampleStudents(12)
    const student = findStudentByStudentId(students, '20260001')
    if (!student) {
      throw new Error('Missing sample student')
    }

    drawForStudent(students, student.studentId, 0)
    drawForStudent(students, '20260002', 0.99)

    const reset = resetSelections(students)
    expect(getSelectedStudents(reset)).toHaveLength(0)
    expect(reset.every((item) => item.attemptsUsed === 0)).toBe(true)
  })
})
