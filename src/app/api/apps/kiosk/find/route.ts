// Публічний за токеном пристрою: пошук броні на терміналі (два чинники,
// цей корпус, вікно ±1 день). src/apps/kiosk/api/stay.handlers.ts.
import { findStay } from '@/apps/kiosk/api/stay.handlers';

export const POST = findStay;
