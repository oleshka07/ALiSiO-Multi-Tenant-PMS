-- ==============================================================================
-- ALiSiO Multi-Tenant PMS - PostgreSQL Seed Data
-- Demo Tenants, Properties, Rooms, Guests, and Bookings
-- ==============================================================================

-- Seed Tenants
INSERT INTO tenants (id, name, slug, domain, plan, status) VALUES
('00000000-0000-0000-0000-000000000001', 'Grand Hotel Kyiv', 'grand-hotel-kyiv', 'grandkyiv.alisio.io', 'enterprise', 'active'),
('00000000-0000-0000-0000-000000000002', 'Seaside Resort Odesa', 'seaside-resort-odesa', 'seasideodesa.alisio.io', 'pro', 'active')
ON CONFLICT (id) DO NOTHING;

-- Seed Roles for Tenant 1
INSERT INTO roles (id, tenant_id, name, description) VALUES
('11111111-1111-1111-1111-111111111101', '00000000-0000-0000-0000-000000000001', 'Tenant Admin', 'Full access to tenant management'),
('11111111-1111-1111-1111-111111111102', '00000000-0000-0000-0000-000000000001', 'Receptionist', 'Front-desk operations and reservations')
ON CONFLICT (id) DO NOTHING;

-- Seed Users for Tenant 1
INSERT INTO users (id, tenant_id, role_id, email, password_hash, first_name, last_name, phone) VALUES
('22222222-2222-2222-2222-222222222201', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101', 'admin@grandkyiv.com', '$2a$12$eImiTXuWVxfM37uY4JANjO5E.534mJ3.uQ3mO5m4u.a.x.534mJ3.', 'Oleksandr', 'Shevchenko', '+380501234567')
ON CONFLICT (id) DO NOTHING;

-- Seed Property for Tenant 1
INSERT INTO properties (id, tenant_id, name, code, type, address, city, country, currency) VALUES
('33333333-3333-3333-3333-333333333301', '00000000-0000-0000-0000-000000000001', 'Grand Hotel Kyiv Central', 'GHK-01', 'hotel', 'Khreshchatyk St, 15', 'Kyiv', 'Ukraine', 'UAH')
ON CONFLICT (id) DO NOTHING;

-- Seed Room Types for Tenant 1
INSERT INTO room_types (id, tenant_id, property_id, name, code, base_occupancy, max_occupancy, base_price) VALUES
('44444444-4444-4444-4444-444444444401', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333301', 'Standard Double', 'STD-DBL', 2, 2, 2500.00),
('44444444-4444-4444-4444-444444444402', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333301', 'Deluxe Executive Suite', 'DLX-STE', 2, 4, 5500.00)
ON CONFLICT (id) DO NOTHING;

-- Seed Rooms for Tenant 1
INSERT INTO rooms (id, tenant_id, property_id, room_type_id, room_number, floor, status) VALUES
('55555555-5555-5555-5555-555555555501', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', '101', '1', 'available'),
('55555555-5555-5555-5555-555555555502', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', '102', '1', 'available'),
('55555555-5555-5555-5555-555555555503', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444402', '201', '2', 'occupied')
ON CONFLICT (id) DO NOTHING;

-- Seed Guests for Tenant 1
INSERT INTO guests (id, tenant_id, first_name, last_name, email, phone, nationality) VALUES
('66666666-6666-6666-6666-666666666601', '00000000-0000-0000-0000-000000000001', 'Ivan', 'Kovalenko', 'ivan.kovalenko@example.com', '+380671112233', 'Ukrainian')
ON CONFLICT (id) DO NOTHING;

-- Seed Bookings for Tenant 1
INSERT INTO bookings (id, tenant_id, property_id, guest_id, room_id, room_type_id, booking_reference, check_in_date, check_out_date, total_price, paid_amount, status) VALUES
('77777777-7777-7777-7777-777777777701', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333301', '66666666-6666-6666-6666-666666666601', '55555555-5555-5555-5555-555555555503', '44444444-4444-4444-4444-444444444402', 'RES-2026-001', CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', 16500.00, 16500.00, 'checked_in')
ON CONFLICT (id) DO NOTHING;

-- Seed Payments for Tenant 1
INSERT INTO payments (id, tenant_id, booking_id, amount, payment_method, status) VALUES
('88888888-8888-8888-8888-888888888801', '00000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777701', 16500.00, 'credit_card', 'completed')
ON CONFLICT (id) DO NOTHING;
