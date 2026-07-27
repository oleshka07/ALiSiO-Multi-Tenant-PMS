// Events emitted by the pricing module.
// Register in src/core/event-bus/registry.ts when first subscriber is added.

export type PricingUpdatedEvent = {
  unitTypeId: string;
  dateFrom: string;
  dateTo: string;
};
