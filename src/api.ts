export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const data = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.')
  return data
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const remove = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}
