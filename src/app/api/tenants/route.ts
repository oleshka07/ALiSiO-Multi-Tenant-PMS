import { store } from '@/lib/store';
import { NextResponse } from 'next/server';

export async function GET() {
  const tenants = store.getTenants();
  return NextResponse.json({ tenants });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, slug } = body;

    if (!name || !slug) {
      return NextResponse.json(
        { error: 'Назва організації та slug є обов’язковими' },
        { status: 400 },
      );
    }

    const tenant = store.createTenant(name, slug);
    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Помилка при створенні організації' }, { status: 500 });
  }
}
