const AUTH_TOKEN = '10cece86cd7e837532aa1ac1231387f40274c1c7fc28292c3a73d11770f5eb8c';

export const config = {
  matcher: ['/maps/data/:path*', '/api/geocode'],
};

export default function middleware(request) {
  const authed = request.cookies.get('soma_maps_auth')?.value === AUTH_TOKEN;
  if (authed) return;

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
