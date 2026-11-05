/**
 * Centralized API Client for G4X Community
 * Utilizes standard HTTP cookies (HttpOnly session cookie)
 * Handles CSRF token extraction and injection for mutating methods
 */

let cachedCsrfToken: string | null = null;

export async function getCsrfToken(): Promise<string | null> {
  if (cachedCsrfToken) return cachedCsrfToken;
  try {
    const res = await fetch('/api/csrf-token', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      cachedCsrfToken = data.csrfToken;
      return cachedCsrfToken;
    }
  } catch (err) {
    console.warn('[API] Could not fetch CSRF token:', err);
  }
  return null;
}

export function clearCsrfTokenCache(): void {
  cachedCsrfToken = null;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await getCsrfToken();
    if (token) {
      headers['x-csrf-token'] = token;
    }
    if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include', // essential for HttpOnly session cookie
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson?.error) {
        errorDetail = errJson.message || errJson.error;
      }
    } catch {
      // not a json response
    }
    const error: any = new Error(errorDetail);
    error.status = response.status;
    throw error;
  }

  // Handle empty responses
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return {} as T;
}
