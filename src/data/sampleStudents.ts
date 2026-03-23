import type { Student } from '../types'

const FAMILY_NAMES = [
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈',
  '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许',
]

const GIVEN_NAMES = [
  '子涵', '雨桐', '宇轩', '思远', '嘉宁', '晨曦', '梓航', '可欣', '浩然', '芷晴',
  '昊天', '一诺', '书瑶', '嘉懿', '奕辰', '俊熙', '清妍', '沐宸', '知夏', '星野',
]

export function createSampleStudents(count = 240): Student[] {
  return Array.from({ length: count }, (_, index) => {
    const familyName = FAMILY_NAMES[index % FAMILY_NAMES.length]
    const givenName = GIVEN_NAMES[(index * 7) % GIVEN_NAMES.length]
    const serial = String(index + 1).padStart(3, '0')

    return {
      id: `student-${serial}`,
      name: `${familyName}${givenName}`,
      studentId: `2026${String(index + 1).padStart(4, '0')}`,
      phoneNumber: `1380000${String(index + 1).padStart(4, '0')}`,
      avatarUrl: '',
      chances: 20,
      attemptsUsed: 0,
      selectedAt: null,
      contestNumber: null,
    }
  })
}
