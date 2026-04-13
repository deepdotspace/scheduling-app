export function randomString(length: number): string {
  let result = ''
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

export function generateRoomId(): string {
  return `${randomString(4)}-${randomString(4)}`
}
