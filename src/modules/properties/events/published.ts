// Events emitted by the properties module.
// These types are registered in src/core/event-bus/registry.ts.
// Subscribe via: eventBus.on('property.created', handler)

export type PropertyCreatedEvent = { propertyId: string; name: string };
export type UnitCreatedEvent = { unitId: string; propertyId: string; name: string };
export type UnitStatusChangedEvent = { unitId: string; status: string };
