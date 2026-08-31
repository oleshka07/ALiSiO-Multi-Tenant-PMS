# Довідник API Hoteliera (зведено з усіх прогонів)

Ендпоінтів: **71**

## `GET /api/actions`

```json
[
 {
  "id": "string",
  "user_id": "string",
  "user_email": "string",
  "user_name": "string",
  "org_id": "string",
  "category": "string",
  "action": "string",
  "object_id": "null",
  "url": "string",
  "before": {
   "id": "string",
   "meta": {
    "acquisition": {
     "source": "string"
    },
    "update_room_conditions_daily": "date"
   },
   "name": "string",
   "slug": "string",
   "about": {
    "logo": {
     "id": "string",
     "url": "string",
     "etag": "string",
     "path": "string",
     "bytes": "number",
     "width": "number",
     "folder": "string",
     "format": "string",
     "height": "number",
     "version": "number",
     "asset_id": "string",
     "signature": "string",
     "created_at": "datetime",
     "version_id": "string",
     "access_mode": "string",
     "resource_type": "string",
     "thumbnail_url": "string",
     "original_filename": "string"
    },
    "photos": [
     {
      "id": "string",
      "url": "string",
      "etag": "string",
      "path": "string",
      "bytes": "number",
      "width": "number",
      "folder": "string",
      "format": "string",
      "height": "number",
      "version": "number",
      "asset_id": "string",
      "signature": "string",
      "created_at": "datetime",
      "version_id": "string",
      "access_mode": "string",
      "resource_type": "string",
      "thumbnail_url": "string",
      "original_filename": "string"
     }
    ],
    "logo_url": "string",
    "photo_urls": [
     "string"
    ],
    "description": {
     "en": "string"
    },
    "favicon_image": {
     "id": "string",
     "url": "string",
     "auto_generated": "boolean"
    }
   },
   "email": "string",
   "phone": "string",
   "settings": {
    "meals": [
     "string"
    ],
    "extrao": [
     {
      "all": {
       "all": {
        "AI": {
         "adult": "…",
         "child": "…"
        },
        "BB": {
         "adult": "…",
         "child": "…"
        },
        "FB": {
         "adult": "…",
         "child": "…"
        },
        "HB": {
         "adult": "…",
         "child": "…"
        },
        "RO": {
         "adult": "…",
         "child": "…"
        },
        "FB+": {
         "adult": "…",
         "child": "…"
        },
        "HB+": {
         "adult": "…",
         "child": "…"
        },
        "UAI": {
         "adult": "…",
         "child": "…"
        }
       }
      }
     }
    ],
    "locale": "string",
    "seasons": [
     {
      "id": "string",
      "name": "string",
      "day_to": "date",
      "day_from": "date"
     }
    ],
    "currency": "string",
    "language": "string",
    "timezone": {
     "name": "string",
     "value": "string"
    },
    "websites": [
     {
      "id": "string",
      "name": "string",
      "email": "string",
      "pages": [
       {
        "id": "numeric-string",
        "type": "string",
        "pages": {
         "en": "…"
        }
       }
      ],
      "phone": "numeric-string",
     
```

## `GET /api/cleaning-jobs`

```json
{
 "today_cleans_vacant": [],
 "today_cleans_occupied": []
}
```

## `GET /api/cleaning-jobs-history`

```json
{
 "data": [],
 "pagination": {
  "currentPage": "number",
  "perPage": "number",
  "totalRows": "number",
  "totalPages": "number",
  "hasNextPage": "boolean",
  "hasPrevPage": "boolean",
  "from": "number",
  "to": "number"
 }
}
```

## `GET /api/get-available-room-types`

```json
{
 "qaglam": [
  {
   "id": "string",
   "location": {
    "id": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "photos": [],
    "address": {},
    "amenities": [],
    "show_logo": "null",
    "meta_title": {},
    "sort_order": "number",
    "description": {},
    "banner_image": {},
    "about_us_text": {},
    "book_now_text": {},
    "favicon_image": {},
    "meta_keywords": {},
    "location_title": {},
    "hide_guest_stay": "null",
    "rates_min_price": "number",
    "meta_description": {},
    "about_description": {},
    "discovery_us_text": {},
    "short_description": {},
    "hide_guest_checkout": "null",
    "client_domain_active": "null",
    "location_channel_text": {},
    "hoteliera_domain_active": "null",
    "show_homepage_gallery_slider": "null",
    "redirect_from_subdomain_to_domain": "null",
    "we_offer_excellent_experience_text": {}
   },
   "description": {
    "en": "string"
   },
   "nrOfAvailableRooms": "number",
   "beds": {
    "double": "number",
    "single": "number"
   },
   "names": {
    "de": "string",
    "en": "string",
    "es": "string",
    "fr": "string",
    "hu": "string",
    "it": "string",
    "mk": "string",
    "nl": "string",
    "ro": "string"
   },
   "maxPersons": "number",
   "occupacyCombinations": [
    {
     "text": "string",
     "adults": "number",
     "selected": "boolean",
     "childrens": []
    }
   ],
   "adults": "number",
   "shared": "boolean",
   "isMutual": "boolean",
   "children": "number",
   "locationId": "string",
   "minAdults": "number",
   "maxAdults": "number",
   "photo_urls": [
    "string"
   ],
   "amenities": [
    "string"
   ],
   "sortOrder": "number",
   "maxChildren": "number",
   "quantitySelected": "number",
   "estimatedPriceAdult": "number",
   "estimatedPriceChild": "number",
   "ratePlans": [
    {
     "id": "string",
     "names": {
      "de": "string",
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "nl": "string",
      "ro": "string"
     },
     "mealPlans": [
      {
       "name": "string",
       "adultMealOnlyBasePrice": "number",
       "pricePerNight": "number",
       "pricePerSelectedPeriod": "number",
       "pricePerSelectedPeriodRegular": "null",
       "quantitySelected": "number",
       "zeroPrice": "boolean"
      }
     ],
     "paymentTerms": {
      "days_before_arrival": "number",
      "installment_on_arrival_percent": "number",
      "installment_reservation_percent": "number",
      "installment_days_before_arrival_percent": "number"
     },
     "cancelationPolicy": "string",
     "outsideMinMaxStay": "boolean",
     "minStay": "null",
     "maxStay": "null",
     "unsatisfiable": "boolean",
     "withRestriction": "boolean",
     "noMealPlansOrBlocked": "boolean"
    }
   ],
   "optionsForExtraPersons": [
    {
     "all": {
      "all": {
       "AI": {
        "adult": {
         "meal": "…
```

## `GET /api/guest-reservation-to-be-reviewed`

```json
{
 "reservation_payments_to_be_reviewed": []
}
```

## `GET /api/invoice`

```json
{
 "data": [
  {
   "id": "string",
   "created_at": "datetime",
   "created_by": "string",
   "updated_at": "null",
   "updated_by": "null",
   "org_id": "string",
   "org_guest_id": "string",
   "company_id": "string",
   "reservation_id": "string",
   "type": "string",
   "series": "string",
   "number": "number",
   "issue_date": "date",
   "currency": "string",
   "line_items": [
    {
     "id": "string",
     "meta": {
      "installment_type": "string",
      "title_overridden": "boolean"
     },
     "note": {
      "en": "string"
     },
     "taxes": [
      {
       "id": "string",
       "name": {
        "en": "string",
        "es": "string",
        "fr": "string",
        "hu": "string",
        "it": "string",
        "mk": "string",
        "ro": "string",
        "default": "string"
       },
       "amount": {
        "type": "string",
        "label": "string",
        "value": "number"
       },
       "apply_to": "string",
       "included": "boolean",
       "tax_type": "string",
       "apply_per": "string",
       "amount_price": "number",
       "apply_period": "string",
       "separate_charge": "boolean",
       "calculated_amount": "number",
       "amount_price_regular": "number"
      }
     ],
     "title": {
      "de": "string",
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "nl": "string",
      "ro": "string"
     },
     "amount": "number",
     "org_id": "string",
     "source": "string",
     "tax_ids": [
      "string"
     ],
     "category": "string",
     "currency": "string",
     "quantity": "number",
     "created_at": "datetime",
     "created_by": "null",
     "invoice_id": "null",
     "product_id": "null",
     "sum_to_pay": "number",
     "tax_amount": "number",
     "updated_at": "datetime",
     "updated_by": "null",
     "paid_amount": "number",
     "billing_live": "boolean",
     "org_guest_id": "string",
     "total_amount": "number",
     "amount_regular": "null",
     "reservation_id": "string",
     "charge_currency": "string",
     "total_tax_amount": "number",
     "amount_with_all_taxes": "number",
     "amount_charge_currency": "number",
     "amount_without_all_taxes": "number",
     "tax_amount_charge_currency": "number",
     "total_amount_with_all_taxes": "number",
     "total_amount_charge_currency": "number",
     "amount_regular_charge_currency": "null",
     "total_amount_without_all_taxes": "number",
     "total_tax_amount_charge_currency": "number",
     "amount_with_all_taxes_charge_currency": "number",
     "amount_without_all_taxes_charge_currency": "number",
     "total_amount_with_all_taxes_charge_currency": "number",
     "total_amount_without_all_taxes_charge_currency": "number"
    }
   ],
   "charges": [],
   "payments": [],
   "total_amount_without_all_taxes": "number",
   "total_amount": "number",
   "total_tax_amount": "number",
   "total_amount_with_all_taxes": "number"
```

## `GET /api/invoice/efactura-overdue-count`

```json
{
 "status": "string",
 "count": "number"
}
```

## `GET /api/notifications`

```json
[]
```

## `GET /api/notifications/filtered`

```json
[]
```

## `GET /api/org`

```json
{
 "id": "string",
 "created_at": "datetime",
 "created_by": "string",
 "updated_at": "datetime",
 "updated_by": "string",
 "name": "string",
 "country_code": "string",
 "phone": "string",
 "email": "string",
 "settings": {
  "meals": [
   "string"
  ],
  "extrao": [
   {
    "all": {
     "all": {
      "AI": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "BB": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "FB": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "HB": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "RO": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "FB+": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "HB+": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "UAI": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      }
     }
    }
   }
  ],
  "locale": "string",
  "seasons": [
   {
    "id": "string",
    "name": "string",
    "da
```

## `GET /api/org_companies`

```json
{
 "data": [
  {
   "id": "string",
   "name": "string",
   "email": "string",
   "phone": "numeric-string",
   "country_code": "string",
   "business_id": "string",
   "business_register_no": "string",
   "vat_number": "null",
   "note": "string",
   "created_at": "datetime",
   "address": {
    "zip": "numeric-string",
    "city": "string",
    "county": "string",
    "address1": "string"
   },
   "bank_account": "string",
   "bank_name": "string",
   "archived": "boolean",
   "has_contact": "boolean",
   "has_bank": "boolean",
   "associated_guests_count": "number"
  }
 ],
 "pagination": {
  "page": "number",
  "perPage": "number",
  "total": "number",
  "totalPages": "number"
 }
}
```

## `GET /api/org_companies/anaf/23430567`

```json
{
 "success": "boolean",
 "error": "string",
 "cui": "numeric-string"
}
```

## `GET /api/org_companies/anaf/4354465465`

```json
{
 "success": "boolean",
 "error": "string",
 "cui": "numeric-string"
}
```

## `GET /api/org_companies/rl07xk`

```json
{
 "id": "string",
 "created_at": "datetime",
 "created_by": "null",
 "updated_at": "null",
 "updated_by": "null",
 "org_id": "string",
 "archived": "boolean",
 "name": "string",
 "business_id": "string",
 "business_register_no": "string",
 "vat_number": "null",
 "bank_name": "string",
 "bank_account": "string",
 "phone": "numeric-string",
 "email": "string",
 "country_code": "string",
 "address": {
  "zip": "numeric-string",
  "city": "string",
  "county": "string",
  "address1": "string"
 },
 "note": "string",
 "search": "string",
 "meta": {},
 "associated_guests_count": "number"
}
```

## `GET /api/org_companies/v66eac`

```json
{
 "id": "string",
 "created_at": "datetime",
 "created_by": "null",
 "updated_at": "null",
 "updated_by": "null",
 "org_id": "string",
 "archived": "boolean",
 "name": "string",
 "business_id": "numeric-string",
 "business_register_no": "null",
 "vat_number": "null",
 "bank_name": "null",
 "bank_account": "null",
 "phone": "numeric-string",
 "email": "null",
 "country_code": "string",
 "address": {
  "zip": "numeric-string",
  "city": "string",
  "county": "string",
  "address1": "string"
 },
 "note": "null",
 "search": "string",
 "meta": {},
 "associated_guests_count": "number"
}
```

## `GET /api/org_guests`

```json
{
 "data": [
  {
   "id": "string",
   "name": "string",
   "email": "string",
   "phone": "string",
   "country_code": "string",
   "tags": [],
   "id_number": "string",
   "dob": "date",
   "note": "string",
   "created_by": "null",
   "created_at": "datetime",
   "org_company_id": "null",
   "companies": [
    "string"
   ],
   "address": {
    "zip": "numeric-string",
    "city": "string",
    "county": "string",
    "country": "string",
    "address1": "string",
    "address2": "string"
   },
   "has_company": "boolean",
   "total_reservations": "number",
   "canceled_reservations": "number",
   "upcoming_reservations": "number",
   "next_reservation_date": "date"
  }
 ],
 "pagination": {
  "page": "number",
  "perPage": "number",
  "total": "number",
  "totalPages": "number"
 }
}
```

## `GET /api/org_guests/v8itxk/companies`

```json
[
 {
  "id": "string",
  "created_at": "datetime",
  "created_by": "null",
  "updated_at": "null",
  "updated_by": "null",
  "org_id": "string",
  "archived": "boolean",
  "name": "string",
  "business_id": "string",
  "business_register_no": "string",
  "vat_number": "null",
  "bank_name": "string",
  "bank_account": "string",
  "phone": "numeric-string",
  "email": "string",
  "country_code": "string",
  "address": {
   "zip": "numeric-string",
   "city": "string",
   "county": "string",
   "address1": "string"
  },
  "note": "string",
  "search": "string",
  "meta": {},
  "associated_guests_count": "number"
 }
]
```

## `GET /api/orgs`

```json
[
 {
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "updated_at": "datetime",
  "updated_by": "string",
  "name": "string",
  "country_code": "string",
  "phone": "string",
  "email": "string",
  "settings": {
   "meals": [
    "string"
   ],
   "extrao": [
    {
     "all": {
      "all": {
       "AI": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "BB": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "FB": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "HB": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "RO": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "FB+": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "HB+": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       },
       "UAI": {
        "adult": {
         "meal": "…",
         "lodging": "…"
        },
        "child": {
         "18": "…"
        }
       }
      }
     }
    }
   ],
   "locale": "string",
   "seasons": [
    {
     "id": "string",
     "name": "string",
     "day_to": "date",
     "day_from": "date"
    }
   ],
   "currency": "string",
   "language": "string",
   "timezone": {
    "name": "string",
    "value": "string"
   },
   "websites": [
    {
     "id": "string",
     "name": "string",
     "email": "string",
     "pages": [
      {
       "id": "numeric-string",
       "type": "string",
       "pages": {
        "en": {
         "title": "…",
         "content": "…",
         "subject": "…",
         "link_name": "…"
        }
       }
      }
     ],
     "phone": "numeric-string",
     "colors": {
      "text_footer_color": "string",
      "text_primary_color": "string",
      "text_secondary_color": "string",
      "background_primary_color": "string",
      "background_warning_color": "string",
      "background_secondary_color": "string"
     },
     "offers": [
      {
       "id": "numeric-string",
       "dayTo": "date",
       "images": [],
       "offers": {
        "en": {
         "title": "…",
         "description": "…",
         "short_description": "…"
        }
       },
       "dayFrom": "date",
       "image_ids": []
      }
     ],
     "photos": [
      {
       "id": "string",
       "url": "string",
       "etag": "string",
       "path": "string",
       "bytes": "number",
       "pages": "number",
       "width": "number",
       "folder": "string",
       "format":
```

## `GET /api/orgs/czqaglq1xn/translation-state`

```json
{
 "status": "string",
 "rows": []
}
```

## `GET /api/otas`

```json
[
 {
  "id": "string",
  "name": "string",
  "description": "string",
  "meta": {
   "require_room_types": "boolean",
   "require_property_id": "boolean"
  }
 }
]
```

## `GET /api/otas-meta/inventory`

```json
[
 {
  "day": "date",
  "direct": {
   "dirty": "boolean",
   "inventory": {
    "room_types": [
     {
      "id": "string",
      "sold": "number",
      "available": "number"
     }
    ]
   },
   "changed_at": "datetime"
  },
  "ota_other": {
   "dirty": "boolean",
   "inventory": {
    "room_types": [
     {
      "id": "string",
      "sold": "number",
      "available": "number",
      "on_request": "boolean"
     }
    ]
   },
   "changed_at": "datetime"
  },
  "ota_booking": {
   "dirty": "boolean",
   "inventory": {
    "room_types": [
     {
      "id": "string",
      "sold": "number",
      "available": "number",
      "on_request": "boolean"
     }
    ]
   },
   "changed_at": "datetime"
  },
  "update_cnt": "number",
  "ota_airbnb": {
   "dirty": "boolean",
   "inventory": {
    "room_types": [
     {
      "id": "string",
      "sold": "number",
      "available": "number",
      "on_request": "boolean"
     }
    ]
   },
   "changed_at": "datetime"
  }
 }
]
```

## `GET /api/payment/0`

```json
{
 "error": "string"
}
```

## `GET /api/payments/search`

```json
{
 "data": [
  {
   "id": "string",
   "created_at": "datetime",
   "created_by": "string",
   "updated_at": "null",
   "updated_by": "null",
   "org_id": "string",
   "org_guest_id": "string",
   "reservation_id": "string",
   "source": "string",
   "method": "string",
   "currency": "string",
   "payment_currency": "string",
   "amount": "number",
   "amount_payment_currency": "number",
   "note": {
    "en": "string"
   },
   "charges": [
    {
     "id": "string",
     "meta": {
      "installment_type": "string"
     },
     "note": "null",
     "taxes": [
      {
       "id": "string",
       "name": {
        "en": "string",
        "es": "string",
        "fr": "string",
        "hu": "string",
        "it": "string",
        "mk": "string",
        "ro": "string",
        "default": "string"
       },
       "amount": {
        "type": "string",
        "label": "string",
        "value": "number"
       },
       "apply_to": "string",
       "included": "boolean",
       "tax_type": "string",
       "apply_per": "string",
       "amount_price": "number",
       "amount_total": {
        "type": "string",
        "label": "string",
        "value": "number"
       },
       "apply_period": "string",
       "separate_charge": "boolean",
       "amount_price_regular": "number"
      }
     ],
     "title": {
      "de": "string",
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "nl": "string",
      "ro": "string"
     },
     "amount": "number",
     "org_id": "string",
     "source": "string",
     "tax_ids": [
      "string"
     ],
     "category": "string",
     "currency": "string",
     "quantity": "number",
     "created_at": "datetime",
     "created_by": "null",
     "invoice_id": "null",
     "product_id": "null",
     "sum_to_pay": "number",
     "tax_amount": "number",
     "updated_at": "null",
     "updated_by": "null",
     "paid_amount": "number",
     "billing_live": "boolean",
     "org_guest_id": "string",
     "total_amount": "number",
     "amount_regular": "null",
     "reservation_id": "string",
     "charge_currency": "string",
     "total_tax_amount": "number",
     "amount_with_all_taxes": "number",
     "amount_charge_currency": "number",
     "amount_without_all_taxes": "number",
     "tax_amount_charge_currency": "number",
     "total_amount_with_all_taxes": "number",
     "total_amount_charge_currency": "number",
     "amount_regular_charge_currency": "null",
     "total_amount_without_all_taxes": "number",
     "total_tax_amount_charge_currency": "number",
     "amount_with_all_taxes_charge_currency": "number",
     "amount_without_all_taxes_charge_currency": "number",
     "total_amount_with_all_taxes_charge_currency": "number",
     "total_amount_without_all_taxes_charge_currency": "number"
    }
   ],
   "invoice_id": "string",
   "meta": {},
   "status": "null",
   "payment_date": "datetime",
   "org_guest_name": "st
```

## `GET /api/product`

```json
[]
```

## `GET /api/released-sync`

```json
[]
```

## `GET /api/reports`

```json
{
 "data": [
  {
   "formated_date": "string",
   "total_rooms_sold": "number",
   "total_price": "number",
   "is_estimated": "boolean",
   "room_type_id": "string",
   "day": "date",
   "adr": "number",
   "occupancy": "number",
   "revPar": "number",
   "blocked_rooms": "number",
   "total_rooms": "number"
  }
 ],
 "total": "number"
}
```

## `GET /api/reports/meal-plan`

```json
{
 "today_summary": {
  "breakfast": {
   "count": "number",
   "adults": "number",
   "children": "number"
  }
 },
 "daily_breakdown": {
  "2026-08-31": {
   "breakfast": []
  },
  "2026-09-01": {
   "breakfast": []
  },
  "2026-09-02": {
   "breakfast": [
    {
     "id": "string",
     "created_at": "datetime",
     "org_id": "string",
     "location_id": "string",
     "day_from": "date",
     "day_to": "date",
     "nights": "number",
     "adults": "number",
     "children": "number",
     "children_ages": [],
     "meal_id": "string",
     "rooms": "number",
     "room_types": {
      "testroomulp2b1": "number"
     },
     "arooms": [
      {
       "id": "string",
       "type_id": "string"
      }
     ],
     "guest_name": "string",
     "guest_phone": "string",
     "guest_email": "null",
     "status": "string",
     "source": "string",
     "source_type": "string",
     "financials": {
      "rate": {
       "price": "number",
       "rooms": [
        {
         "price": "…",
         "adults": "…",
         "shared": "…",
         "aadults": "…",
         "meal_id": "…",
         "type_id": "…",
         "children": "…",
         "achildren": "…",
         "occupancy": "…",
         "max_adults": "…",
         "max_persons": "…",
         "price_guess": "…",
         "price_total": "…",
         "extra_adults": "…",
         "max_children": "…",
         "children_ages": "…",
         "price_regular": "…",
         "extra_children": "…",
         "extra_adults_total": "…",
         "extra_children_total": "…",
         "extra_adults_meal_total": "…",
         "price_without_all_taxes": "…",
         "extra_children_meal_total": "…",
         "extra_adults_lodging_total": "…",
         "extra_children_lodging_total": "…"
        }
       ],
       "rules": [],
       "taxes": [
        {
         "id": "…",
         "name": "…",
         "amount": "…",
         "apply_to": "…",
         "included": "…",
         "tax_type": "…",
         "apply_per": "…",
         "amount_price": "…",
         "amount_total": "…",
         "apply_period": "…",
         "separate_charge": "…",
         "amount_price_regular": "…"
        }
       ],
       "policy": [],
       "meal_id": "string",
       "currency": "string",
       "total_tax": "number",
       "line_items": [],
       "meal_details": {
        "breakfast": {
         "value": "…",
         "provided_as": "…"
        }
       },
       "payment_terms": {
        "days_before_arrival": "number",
        "installment_on_arrival_percent": "number",
        "installment_reservation_percent": "number",
        "installment_days_before_arrival_percent": "number"
       },
       "price_per_day": [
        {
         "data": "…",
         "date": "…"
        }
       ],
       "price_regular": "null",
       "price_results": [
        {
         "day": "…",
         "rules": "…",
         "season": "…",
         "rate_price": "…",
         "extra_adult": "…",
         "extra_children": "…
```

## `GET /api/reservations`

```json
[
 {
  "org_id": "string",
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "created_by_name": "string",
  "updated_at": "datetime",
  "updated_by_name": "string",
  "updated_by": "string",
  "org_guest_id": "string",
  "guest_id": "null",
  "location_id": "string",
  "adults": "number",
  "children": "number",
  "children_ages": [
   "number"
  ],
  "meal_id": "string",
  "rooms": "number",
  "room_types": {
   "doubledeluxzxnb16": "number"
  },
  "room_types_persons": [
   {
    "name": "string",
    "found": "boolean",
    "childAges": [],
    "room_type": "string",
    "uniqueKey": "string",
    "room_number": "numeric-string",
    "numberOfAdults": "number",
    "numberOfChildren": "number"
   }
  ],
  "room_allocation": "string",
  "rooms_detail": [
   {
    "id": "string",
    "number": "numeric-string",
    "type_id": "string",
    "uniqueKey": "string",
    "org_guest_id": "string"
   }
  ],
  "arooms": [
   {
    "id": "string",
    "type_id": "string"
   }
  ],
  "day_from": "date",
  "day_to": "date",
  "nights": "number",
  "arrival_time": "string",
  "departure_time": "null",
  "note": "null",
  "status": "string",
  "tags": [],
  "cancellation": "null",
  "notifications": [],
  "confirmations": [],
  "financials": {
   "rate": {
    "price": "number",
    "rooms": [
     {
      "price": "number",
      "adults": "number",
      "shared": "boolean",
      "aadults": "number",
      "type_id": "string",
      "children": "number",
      "achildren": "number",
      "occupancy": "number",
      "max_adults": "number",
      "max_persons": "number",
      "price_guess": "number",
      "price_total": "number",
      "extra_adults": "number",
      "max_children": "number",
      "children_ages": [],
      "price_regular": "number",
      "extra_children": "number",
      "extra_adults_total": "number",
      "extra_children_total": "number",
      "extra_adults_meal_total": "number",
      "price_without_all_taxes": "number",
      "extra_children_meal_total": "number",
      "extra_adults_lodging_total": "number",
      "extra_children_lodging_total": "number"
     }
    ],
    "rules": [],
    "taxes": [
     {
      "id": "string",
      "name": {
       "en": "string",
       "es": "string",
       "fr": "string",
       "hu": "string",
       "it": "string",
       "mk": "string",
       "ro": "string",
       "default": "string"
      },
      "amount": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_to": "string",
      "included": "boolean",
      "tax_type": "string",
      "apply_per": "string",
      "amount_price": "number",
      "amount_total": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_period": "string",
      "separate_charge": "boolean",
      "amount_price_regular": "number"
     }
    ],
    "policy": [],
    "meal_id": "string",
    "currency": "string",
    "total_tax": "number",
  
```

## `GET /api/reservations-orgs`

```json
[
 {
  "org_id": "string",
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "created_by_name": "string",
  "updated_at": "datetime",
  "updated_by_name": "string",
  "updated_by": "string",
  "org_guest_id": "string",
  "guest_id": "null",
  "location_id": "string",
  "adults": "number",
  "children": "number",
  "children_ages": [
   "number"
  ],
  "meal_id": "string",
  "rooms": "number",
  "room_types": {
   "doubledeluxzxnb16": "number"
  },
  "room_types_persons": [
   {
    "name": "string",
    "found": "boolean",
    "childAges": [],
    "room_type": "string",
    "uniqueKey": "string",
    "room_number": "numeric-string",
    "numberOfAdults": "number",
    "numberOfChildren": "number"
   }
  ],
  "room_allocation": "string",
  "rooms_detail": [
   {
    "id": "string",
    "number": "numeric-string",
    "type_id": "string",
    "uniqueKey": "string",
    "org_guest_id": "string"
   }
  ],
  "arooms": [
   {
    "id": "string",
    "type_id": "string"
   }
  ],
  "day_from": "date",
  "day_to": "date",
  "nights": "number",
  "arrival_time": "string",
  "departure_time": "null",
  "note": "null",
  "status": "string",
  "tags": [],
  "cancellation": "null",
  "notifications": [],
  "confirmations": [],
  "financials": {
   "rate": {
    "price": "number",
    "rooms": [
     {
      "price": "number",
      "adults": "number",
      "shared": "boolean",
      "aadults": "number",
      "type_id": "string",
      "children": "number",
      "achildren": "number",
      "occupancy": "number",
      "max_adults": "number",
      "max_persons": "number",
      "price_guess": "number",
      "price_total": "number",
      "extra_adults": "number",
      "max_children": "number",
      "children_ages": [],
      "price_regular": "number",
      "extra_children": "number",
      "extra_adults_total": "number",
      "extra_children_total": "number",
      "extra_adults_meal_total": "number",
      "price_without_all_taxes": "number",
      "extra_children_meal_total": "number",
      "extra_adults_lodging_total": "number",
      "extra_children_lodging_total": "number"
     }
    ],
    "rules": [],
    "taxes": [
     {
      "id": "string",
      "name": {
       "en": "string",
       "es": "string",
       "fr": "string",
       "hu": "string",
       "it": "string",
       "mk": "string",
       "ro": "string",
       "default": "string"
      },
      "amount": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_to": "string",
      "included": "boolean",
      "tax_type": "string",
      "apply_per": "string",
      "amount_price": "number",
      "amount_total": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_period": "string",
      "separate_charge": "boolean",
      "amount_price_regular": "number"
     }
    ],
    "policy": [],
    "meal_id": "string",
    "currency": "string",
    "total_tax": "number",
  
```

## `GET /api/reservations/messages/v1ovmb6j`

```json
{
 "status": "string",
 "messages": []
}
```

## `GET /api/reservations/nk7kk5s6`

```json
{
 "org_id": "string",
 "id": "string",
 "created_at": "datetime",
 "created_by": "string",
 "created_by_name": "string",
 "updated_at": "datetime",
 "updated_by_name": "string",
 "updated_by": "string",
 "org_guest_id": "string",
 "guest_id": "null",
 "location_id": "string",
 "adults": "number",
 "children": "number",
 "children_ages": [
  "number"
 ],
 "meal_id": "string",
 "rooms": "number",
 "room_types": {
  "doubledeluxzxnb16": "number"
 },
 "room_types_persons": [
  {
   "name": "string",
   "found": "boolean",
   "childAges": [],
   "room_type": "string",
   "uniqueKey": "string",
   "room_number": "numeric-string",
   "numberOfAdults": "number",
   "numberOfChildren": "number"
  }
 ],
 "room_allocation": "string",
 "rooms_detail": [
  {
   "id": "string",
   "number": "numeric-string",
   "type_id": "string",
   "uniqueKey": "string",
   "org_guest_id": "string"
  }
 ],
 "arooms": [
  {
   "id": "string",
   "type_id": "string"
  }
 ],
 "day_from": "date",
 "day_to": "date",
 "nights": "number",
 "arrival_time": "string",
 "departure_time": "null",
 "note": "null",
 "status": "string",
 "tags": [],
 "cancellation": "null",
 "notifications": [],
 "confirmations": [],
 "financials": {
  "rate": {
   "price": "number",
   "rooms": [
    {
     "price": "number",
     "adults": "number",
     "shared": "boolean",
     "aadults": "number",
     "type_id": "string",
     "children": "number",
     "achildren": "number",
     "occupancy": "number",
     "max_adults": "number",
     "max_persons": "number",
     "price_guess": "number",
     "price_total": "number",
     "extra_adults": "number",
     "max_children": "number",
     "children_ages": [],
     "price_regular": "number",
     "extra_children": "number",
     "extra_adults_total": "number",
     "extra_children_total": "number",
     "extra_adults_meal_total": "number",
     "price_without_all_taxes": "number",
     "extra_children_meal_total": "number",
     "extra_adults_lodging_total": "number",
     "extra_children_lodging_total": "number"
    }
   ],
   "rules": [],
   "taxes": [
    {
     "id": "string",
     "name": {
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "ro": "string",
      "default": "string"
     },
     "amount": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_to": "string",
     "included": "boolean",
     "tax_type": "string",
     "apply_per": "string",
     "amount_price": "number",
     "amount_total": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_period": "string",
     "separate_charge": "boolean",
     "amount_price_regular": "number"
    }
   ],
   "policy": [],
   "meal_id": "string",
   "currency": "string",
   "total_tax": "number",
   "line_items": [],
   "meal_details": "null",
   "payment_terms": {
    "days_before_arrival": "number",
    "installment_on_arrival
```

## `GET /api/reservations/qpazlsc3`

```json
{
 "org_id": "string",
 "id": "string",
 "created_at": "datetime",
 "created_by": "string",
 "created_by_name": "string",
 "updated_at": "datetime",
 "updated_by_name": "string",
 "updated_by": "string",
 "org_guest_id": "string",
 "guest_id": "null",
 "location_id": "string",
 "adults": "number",
 "children": "number",
 "children_ages": "null",
 "meal_id": "null",
 "rooms": "number",
 "room_types": {},
 "room_types_persons": [],
 "room_allocation": "string",
 "rooms_detail": [],
 "arooms": [],
 "day_from": "date",
 "day_to": "date",
 "nights": "number",
 "arrival_time": "null",
 "departure_time": "null",
 "note": "null",
 "status": "string",
 "tags": [
  "string"
 ],
 "cancellation": "null",
 "notifications": [],
 "confirmations": [],
 "financials": {
  "balance_due": "number",
  "total_amount_charges": "number",
  "total_amount_payments": "number"
 },
 "rules": "null",
 "search": "string",
 "source_type": "string",
 "source": "string",
 "ota_reservation_id": "null",
 "is_with_conflict": "number",
 "admin_note": "string",
 "guest_name": "string",
 "guest_first_name": "string",
 "guest_last_name": "string",
 "guest_phone": "string",
 "guest_email": "null",
 "guest_photo_url": "null",
 "guest_address": "null",
 "charges": [],
 "payments": [],
 "invoices": [],
 "meta": {
  "language": "string",
  "company_data": {
   "id": "string",
   "meta": {},
   "name": "string",
   "note": "null",
   "email": "null",
   "phone": "numeric-string",
   "org_id": "string",
   "search": "string",
   "address": {
    "zip": "numeric-string",
    "city": "string",
    "county": "string",
    "address1": "string"
   },
   "archived": "boolean",
   "bank_name": "null",
   "created_at": "datetime",
   "created_by": "null",
   "updated_at": "null",
   "updated_by": "null",
   "vat_number": "null",
   "business_id": "numeric-string",
   "bank_account": "null",
   "country_code": "string",
   "business_register_no": "null",
   "associated_guests_count": "number"
  },
  "legal_entity": "boolean",
  "language_source": "string",
  "linked_reservation_ids": []
 },
 "parent_id": "null",
 "org_check_in_time": "string",
 "org_check_out_time": "string",
 "guest_images": "null",
 "guest_token": "string",
 "guest_language": "string",
 "guest_language_source": "string",
 "related_reservations_ids": [],
 "reservation_messages_count": "number"
}
```

## `GET /api/reservations/summary`

```json
{
 "total": "number",
 "status": {
  "New": "number",
  "Confirmed": "number",
  "Checked-in": "number",
  "Checked-out": "number",
  "Canceled": "number"
 },
 "guests": {
  "adults": "number",
  "children": "number",
  "total": "number"
 },
 "rooms": {
  "total": "number",
  "status": {
   "New": "number",
   "Confirmed": "number",
   "Checked-in": "number",
   "Checked-out": "number",
   "Canceled": "number"
  }
 }
}
```

## `GET /api/reservations/v1ovmb6j`

```json
{
 "org_id": "string",
 "id": "string",
 "created_at": "datetime",
 "created_by": "string",
 "created_by_name": "string",
 "updated_at": "datetime",
 "updated_by_name": "string",
 "updated_by": "string",
 "org_guest_id": "string",
 "guest_id": "null",
 "location_id": "string",
 "adults": "number",
 "children": "number",
 "children_ages": [],
 "meal_id": "string",
 "rooms": "number",
 "room_types": {
  "doublebn3x95": "number"
 },
 "room_types_persons": [
  {
   "name": "string",
   "found": "boolean",
   "childAges": [],
   "room_type": "string",
   "uniqueKey": "string",
   "room_number": "numeric-string",
   "numberOfAdults": "number",
   "numberOfChildren": "number"
  }
 ],
 "room_allocation": "string",
 "rooms_detail": [
  {
   "id": "string",
   "number": "numeric-string",
   "type_id": "string",
   "uniqueKey": "string",
   "org_guest_id": "string"
  }
 ],
 "arooms": [
  {
   "id": "string",
   "type_id": "string"
  }
 ],
 "day_from": "date",
 "day_to": "date",
 "nights": "number",
 "arrival_time": "string",
 "departure_time": "null",
 "note": "null",
 "status": "string",
 "tags": [],
 "cancellation": "null",
 "notifications": [],
 "confirmations": [],
 "financials": {
  "rate": {
   "price": "number",
   "rooms": [
    {
     "price": "number",
     "adults": "number",
     "shared": "boolean",
     "aadults": "number",
     "meal_id": "string",
     "type_id": "string",
     "children": "number",
     "achildren": "number",
     "occupancy": "number",
     "max_adults": "number",
     "max_persons": "number",
     "price_guess": "number",
     "price_total": "number",
     "extra_adults": "number",
     "max_children": "number",
     "children_ages": [],
     "price_regular": "number",
     "extra_children": "number",
     "extra_adults_total": "number",
     "extra_children_total": "number",
     "extra_adults_meal_total": "number",
     "price_without_all_taxes": "number",
     "extra_children_meal_total": "number",
     "extra_adults_lodging_total": "number",
     "extra_children_lodging_total": "number"
    }
   ],
   "rules": [],
   "taxes": [
    {
     "id": "string",
     "name": {
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "ro": "string",
      "default": "string"
     },
     "amount": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_to": "string",
     "included": "boolean",
     "tax_type": "string",
     "apply_per": "string",
     "amount_price": "number",
     "amount_total": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_period": "string",
     "separate_charge": "boolean",
     "amount_price_regular": "number"
    }
   ],
   "policy": [],
   "meal_id": "string",
   "currency": "string",
   "total_tax": "number",
   "line_items": [],
   "meal_details": {
    "breakfast": {
     "value": "number",
     "provided_as": "string"
    }
   },

```

## `GET /api/room-rates`

```json
{
 "czqaglq1xn": {
  "2026-08-31": {
   "room_types": [
    {
     "id": "string",
     "rate_plans": []
    }
   ]
  },
  "2026-09-01": {
   "room_types": [
    {
     "id": "string",
     "rate_plans": [
      {
       "id": "string",
       "start_day": "string",
       "end_day": "string",
       "offer_type": "string",
       "name": {
        "de": "string",
        "en": "string",
        "es": "string",
        "fr": "string",
        "hu": "string",
        "it": "string",
        "mk": "string",
        "nl": "string",
        "ro": "string"
       },
       "rates": [
        {
         "currency": "…",
         "meal_id": "…",
         "price_without_rules": "…",
         "price_with_rules": "…",
         "rules": "…",
         "price_without_all_taxes": "…",
         "total_tax": "…",
         "line_items": "…",
         "taxes": "…",
         "price": "…",
         "price_regular": "…",
         "rooms": "…",
         "price_results": "…",
         "price_per_day": "…",
         "meal_details": "…",
         "policy": "…",
         "extra_adult_surcharge": "…",
         "payment_terms": "…",
         "restriction_reservation_los_min": "…",
         "restriction_reservation_los_max": "…",
         "los_min_overridden": "…",
         "los_max_overridden": "…",
         "los_min_season_default": "…",
         "los_max_season_default": "…",
         "los_unsatisfiable": "…"
        }
       ]
      }
     ]
    }
   ]
  },
  "2026-09-02": {
   "room_types": [
    {
     "id": "string",
     "rate_plans": [
      {
       "id": "string",
       "start_day": "string",
       "end_day": "string",
       "offer_type": "string",
       "name": {
        "de": "string",
        "en": "string",
        "es": "string",
        "fr": "string",
        "hu": "string",
        "it": "string",
        "mk": "string",
        "nl": "string",
        "ro": "string"
       },
       "rates": [
        {
         "currency": "…",
         "meal_id": "…",
         "price_without_rules": "…",
         "price_with_rules": "…",
         "rules": "…",
         "price_without_all_taxes": "…",
         "total_tax": "…",
         "line_items": "…",
         "taxes": "…",
         "price": "…",
         "price_regular": "…",
         "rooms": "…",
         "price_results": "…",
         "price_per_day": "…",
         "meal_details": "…",
         "policy": "…",
         "extra_adult_surcharge": "…",
         "payment_terms": "…",
         "restriction_reservation_los_min": "…",
         "restriction_reservation_los_max": "…",
         "los_min_overridden": "…",
         "los_max_overridden": "…",
         "los_min_season_default": "…",
         "los_max_season_default": "…",
         "los_unsatisfiable": "…"
        }
       ]
      }
     ]
    }
   ]
  },
  "2026-09-03": {
   "room_types": [
    {
     "id": "string",
     "rate_plans": [
      {
       "id": "string",
       "start_day": "string",
       "end_day": "string",
       "offer_type": "string",
  
```

## `GET /api/room-status`

```json
[
 {
  "id": "string",
  "number": "numeric-string",
  "name": "null",
  "type_id": "string",
  "status_meta": {},
  "condition": "string",
  "condition_meta": {},
  "meta": {
   "view": "string",
   "floor": "numeric-string",
   "wifi_name": "string",
   "locker_code": "numeric-string",
   "wifi_password": "string"
  },
  "status": "string"
 }
]
```

## `GET /api/room-types-inventory`

```json
{
 "czqaglq1xn": {
  "2026-08-31": {
   "room_types": [
    {
     "id": "string",
     "total": "number",
     "sold": "number",
     "available": "number",
     "allotment": "number",
     "blocked": "number",
     "warnings": [],
     "has_warning": "number",
     "warning": "string"
    }
   ],
   "occupancy": {
    "_total": "number"
   },
   "total": {
    "_total": "number",
    "_allotment": "number",
    "_sold": "number",
    "_available": "number",
    "testroomulp2b1": "number",
    "doublebn3x95": "number",
    "doubledeluxzxnb16": "number"
   },
   "ota_other": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",
       "available": "number",
       "on_request": "boolean"
      }
     ]
    }
   },
   "ota_booking": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",
       "available": "number",
       "on_request": "boolean"
      }
     ]
    }
   },
   "ota_airbnb": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",
       "available": "number",
       "on_request": "boolean"
      }
     ]
    }
   }
  },
  "2026-09-01": {
   "room_types": [
    {
     "id": "string",
     "total": "number",
     "sold": "number",
     "available": "number",
     "allotment": "number",
     "blocked": "number",
     "warnings": [],
     "has_warning": "number",
     "warning": "string"
    }
   ],
   "occupancy": {
    "_total": "number"
   },
   "total": {
    "_total": "number",
    "_allotment": "number",
    "_sold": "number",
    "_available": "number",
    "testroomulp2b1": "number",
    "doublebn3x95": "number",
    "doubledeluxzxnb16": "number"
   },
   "ota_other": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",
       "available": "number",
       "on_request": "boolean"
      }
     ]
    }
   },
   "ota_booking": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",
       "available": "number",
       "on_request": "boolean"
      }
     ]
    }
   },
   "ota_airbnb": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",
       "available": "number",
       "on_request": "boolean"
      }
     ]
    }
   }
  },
  "2026-09-02": {
   "room_types": [
    {
     "id": "string",
     "total": "number",
     "sold": "number",
     "available": "number",
     "allotment": "number",
     "blocked": "number",
     "warnings": [],
     "has_warning": "number",
     "warning": "string"
    }
   ],
   "occupancy": {
    "_total": "number"
   },
   "total": {
    "_total": "number",
    "_allotment": "number",
    "_sold": "number",
    "_available": "number",
    "testroomulp2b1": "number",
    "doublebn3x95": "number",
    "doubledeluxzxnb16": "number"
   },
   "ota_other": {
    "inventory": {
     "room_types": [
      {
       "id": "string",
       "sold": "number",

```

## `GET /api/rooms`

```json
[
 {
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "updated_at": "datetime",
  "updated_by": "null",
  "org_id": "string",
  "type_id": "string",
  "number": "numeric-string",
  "name": "null",
  "status": "null",
  "status_meta": {},
  "condition": "string",
  "condition_meta": {},
  "meta": {
   "view": "string",
   "floor": "numeric-string",
   "wifi_name": "string",
   "locker_code": "numeric-string",
   "wifi_password": "string"
  }
 }
]
```

## `GET /api/staff`

```json
[
 {
  "id": "string",
  "name": "string",
  "email": "string",
  "role": "string",
  "role_id": "null",
  "permissions": [
   "string"
  ],
  "settings": {
   "language": "string",
   "ui_languages": [
    "string"
   ]
  },
  "last_signed_in_at": "datetime",
  "phone": "string"
 }
]
```

## `GET /api/statistics`

```json
{
 "data": [],
 "total": "number",
 "sort": [
  "string"
 ],
 "limit": "numeric-string",
 "offset": "numeric-string",
 "is_blocked": "string",
 "created_at_day_from": "date",
 "created_at_day_to": "date",
 "stay_period_day_from": "date",
 "stay_period_day_to": "date",
 "check_in": "string",
 "check_out": "string",
 "statuses": [
  "string"
 ],
 "exclude_canceled": "string",
 "visible_columns": [
  "string"
 ],
 "https://admin.hoteliera.com/#/statistics": "string"
}
```

## `GET /api/statistics/organizations`

```json
[
 {
  "id": "string",
  "name": "string"
 }
]
```

## `GET /api/statistics/reservations`

```json
[
 {
  "total_rows": "number",
  "org_id": "string",
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "created_by_name": "string",
  "updated_at": "datetime",
  "updated_by_name": "string",
  "updated_by": "string",
  "org_guest_id": "string",
  "guest_id": "null",
  "location_id": "string",
  "adults": "number",
  "children": "number",
  "children_ages": [
   "number"
  ],
  "meal_id": "string",
  "rooms": "number",
  "room_types": {
   "doubledeluxzxnb16": "number"
  },
  "room_types_persons": [
   {
    "name": "string",
    "found": "boolean",
    "childAges": [],
    "room_type": "string",
    "uniqueKey": "string",
    "room_number": "numeric-string",
    "numberOfAdults": "number",
    "numberOfChildren": "number"
   }
  ],
  "room_allocation": "string",
  "rooms_detail": [
   {
    "id": "string",
    "number": "numeric-string",
    "type_id": "string",
    "uniqueKey": "string",
    "org_guest_id": "string"
   }
  ],
  "arooms": [
   {
    "id": "string",
    "type_id": "string"
   }
  ],
  "day_from": "date",
  "day_to": "date",
  "nights": "number",
  "arrival_time": "string",
  "departure_time": "null",
  "note": "null",
  "status": "string",
  "tags": [],
  "cancellation": "null",
  "notifications": [],
  "confirmations": [],
  "financials": {
   "rate": {
    "price": "number",
    "rooms": [
     {
      "price": "number",
      "adults": "number",
      "shared": "boolean",
      "aadults": "number",
      "type_id": "string",
      "children": "number",
      "achildren": "number",
      "occupancy": "number",
      "max_adults": "number",
      "max_persons": "number",
      "price_guess": "number",
      "price_total": "number",
      "extra_adults": "number",
      "max_children": "number",
      "children_ages": [],
      "price_regular": "number",
      "extra_children": "number",
      "extra_adults_total": "number",
      "extra_children_total": "number",
      "extra_adults_meal_total": "number",
      "price_without_all_taxes": "number",
      "extra_children_meal_total": "number",
      "extra_adults_lodging_total": "number",
      "extra_children_lodging_total": "number"
     }
    ],
    "rules": [],
    "taxes": [
     {
      "id": "string",
      "name": {
       "en": "string",
       "es": "string",
       "fr": "string",
       "hu": "string",
       "it": "string",
       "mk": "string",
       "ro": "string",
       "default": "string"
      },
      "amount": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_to": "string",
      "included": "boolean",
      "tax_type": "string",
      "apply_per": "string",
      "amount_price": "number",
      "amount_total": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_period": "string",
      "separate_charge": "boolean",
      "amount_price_regular": "number"
     }
    ],
    "policy": [],
    "meal_id": "string",
    "currency": "string",
   
```

## `GET /api/support/tickets`

```json
{
 "data": [],
 "meta": {
  "page": "number",
  "perPage": "number",
  "total": "number"
 }
}
```

## `GET /api/support/tickets/unread-count`

```json
{
 "count": "number"
}
```

## `GET /api/users/sessions`

```json
{
 "id": "string",
 "email": "string",
 "settings": {
  "language": "string",
  "ui_languages": [
   "string"
  ]
 },
 "title": "string",
 "first_name": "string",
 "last_name": "string",
 "name": "string",
 "role": "string",
 "role_name": "null",
 "permissions": [
  "string"
 ],
 "initial_org_id": "null",
 "org_id": "string",
 "org_name": "string",
 "org_country_code": "string",
 "org_slug": "string",
 "org_phone": "string",
 "org_email": "string",
 "org_logo_url": "string",
 "language": "string",
 "org_settings": {
  "meals": [
   "string"
  ],
  "extrao": [
   {
    "all": {
     "all": {
      "AI": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "BB": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "FB": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "HB": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "RO": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "FB+": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "HB+": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        "lodging": {
         "mode": "…",
         "value": "…"
        }
       },
       "child": {
        "18": {
         "meal": "…",
         "lodging": "…"
        }
       }
      },
      "UAI": {
       "adult": {
        "meal": {
         "mode": "…",
         "value": "…",
         "service": "…"
        },
        
```

## `GET https://guest.hoteliera.com/api/anonymous-org-by-location/i5oy67fk`

```json
{
 "organization": {
  "slug_full": "string",
  "id": "string",
  "name": "string",
  "phone": "string",
  "email": "string",
  "country_code": "string",
  "logo_url": "string",
  "about": {
   "logo_url": "string",
   "photo_urls": [
    "string"
   ],
   "description": {
    "en": "string"
   },
   "favicon_image": {
    "id": "string",
    "url": "string",
    "auto_generated": "boolean"
   }
  },
  "rate_plans": [
   {
    "id": "string",
    "name": {
     "de": "string",
     "en": "string",
     "es": "string",
     "fr": "string",
     "hu": "string",
     "it": "string",
     "mk": "string",
     "nl": "string",
     "ro": "string"
    },
    "rates": {
     "spx4k": {
      "adult_BB": {
       "rate": "number"
      },
      "adult_RO": {
       "rate": "number"
      },
      "rtdoublebn3x95": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rt_los_overrides": {
       "rtdoublebn3x95": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rttestroomulp2b1": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rtdoubledeluxzxnb16": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       }
      },
      "rttestroomulp2b1": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rtdoubledeluxzxnb16": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "restriction_reservation_los_max": "number",
      "restriction_reservation_los_min": "number"
     },
     "stmwa": {
      "adult_BB": {
       "rate": "number"
      },
      "adult_RO": {
       "rate": "number"
      },
      "rtdoublebn3x95": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rt_los_overrides": {
       "rtdoublebn3x95": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rttestroomulp2b1": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rtdoubledeluxzxnb16": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       }
      },
      "rttestroomulp2b1": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rtdoubledeluxzxnb16": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       }
```

## `GET https://guest.hoteliera.com/api/anonymous-org-by-location/qaglam`

```json
{
 "organization": {
  "slug_full": "string",
  "id": "string",
  "name": "string",
  "phone": "string",
  "email": "string",
  "country_code": "string",
  "logo_url": "string",
  "about": {
   "logo_url": "string",
   "photo_urls": [
    "string"
   ],
   "description": {
    "en": "string"
   },
   "favicon_image": {
    "id": "string",
    "url": "string",
    "auto_generated": "boolean"
   }
  },
  "rate_plans": [
   {
    "id": "string",
    "name": {
     "de": "string",
     "en": "string",
     "es": "string",
     "fr": "string",
     "hu": "string",
     "it": "string",
     "mk": "string",
     "nl": "string",
     "ro": "string"
    },
    "rates": {
     "spx4k": {
      "adult_BB": {
       "rate": "number"
      },
      "adult_RO": {
       "rate": "number"
      },
      "rtdoublebn3x95": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rt_los_overrides": {
       "rtdoublebn3x95": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rttestroomulp2b1": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rtdoubledeluxzxnb16": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       }
      },
      "rttestroomulp2b1": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rtdoubledeluxzxnb16": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "restriction_reservation_los_max": "number",
      "restriction_reservation_los_min": "number"
     },
     "stmwa": {
      "adult_BB": {
       "rate": "number"
      },
      "adult_RO": {
       "rate": "number"
      },
      "rtdoublebn3x95": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rt_los_overrides": {
       "rtdoublebn3x95": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rttestroomulp2b1": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rtdoubledeluxzxnb16": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       }
      },
      "rttestroomulp2b1": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rtdoubledeluxzxnb16": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       }
```

## `GET https://guest.hoteliera.com/api/anonymous-org-by-location/qs17qey0`

```json
{
 "organization": {
  "slug_full": "string",
  "id": "string",
  "name": "string",
  "phone": "string",
  "email": "string",
  "country_code": "string",
  "logo_url": "string",
  "about": {
   "logo_url": "string",
   "photo_urls": [
    "string"
   ],
   "description": {
    "en": "string"
   },
   "favicon_image": {
    "id": "string",
    "url": "string",
    "auto_generated": "boolean"
   }
  },
  "rate_plans": [
   {
    "id": "string",
    "name": {
     "de": "string",
     "en": "string",
     "es": "string",
     "fr": "string",
     "hu": "string",
     "it": "string",
     "mk": "string",
     "nl": "string",
     "ro": "string"
    },
    "rates": {
     "spx4k": {
      "adult_BB": {
       "rate": "number"
      },
      "adult_RO": {
       "rate": "number"
      },
      "rtdoublebn3x95": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rt_los_overrides": {
       "rtdoublebn3x95": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rttestroomulp2b1": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rtdoubledeluxzxnb16": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       }
      },
      "rttestroomulp2b1": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rtdoubledeluxzxnb16": {
       "BB": {
        "rate": "null"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "restriction_reservation_los_max": "number",
      "restriction_reservation_los_min": "number"
     },
     "stmwa": {
      "adult_BB": {
       "rate": "number"
      },
      "adult_RO": {
       "rate": "number"
      },
      "rtdoublebn3x95": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rt_los_overrides": {
       "rtdoublebn3x95": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rttestroomulp2b1": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       },
       "rtdoubledeluxzxnb16": {
        "restriction_reservation_los_max": "null",
        "restriction_reservation_los_min": "null"
       }
      },
      "rttestroomulp2b1": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       },
       "pppn": {
        "rate": "number"
       }
      },
      "rtdoubledeluxzxnb16": {
       "BB": {
        "rate": "number"
       },
       "RO": {
        "rate": "number"
       }
```

## `GET https://guest.hoteliera.com/api/exchange-rates/CZK`

```json
{
 "status": "string",
 "base_currency": "string",
 "rates": []
}
```

## `GET https://guest.hoteliera.com/api/get-available-room-types`

```json
{
 "qaglam": [
  {
   "id": "string",
   "location": {
    "id": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "photos": [],
    "address": {},
    "amenities": [],
    "show_logo": "null",
    "meta_title": {},
    "sort_order": "number",
    "description": {},
    "banner_image": {},
    "about_us_text": {},
    "book_now_text": {},
    "favicon_image": {},
    "meta_keywords": {},
    "location_title": {},
    "hide_guest_stay": "null",
    "rates_min_price": "number",
    "meta_description": {},
    "about_description": {},
    "discovery_us_text": {},
    "short_description": {},
    "hide_guest_checkout": "null",
    "client_domain_active": "null",
    "location_channel_text": {},
    "hoteliera_domain_active": "null",
    "show_homepage_gallery_slider": "null",
    "redirect_from_subdomain_to_domain": "null",
    "we_offer_excellent_experience_text": {}
   },
   "description": {
    "en": "string"
   },
   "nrOfAvailableRooms": "number",
   "beds": {
    "double": "number",
    "single": "number"
   },
   "names": {
    "de": "string",
    "en": "string",
    "es": "string",
    "fr": "string",
    "hu": "string",
    "it": "string",
    "mk": "string",
    "nl": "string",
    "ro": "string"
   },
   "maxPersons": "number",
   "occupacyCombinations": [
    {
     "text": "string",
     "adults": "number",
     "selected": "boolean",
     "childrens": []
    }
   ],
   "adults": "number",
   "shared": "boolean",
   "isMutual": "boolean",
   "children": "number",
   "locationId": "string",
   "minAdults": "number",
   "maxAdults": "number",
   "photo_urls": [
    "string"
   ],
   "amenities": [
    "string"
   ],
   "sortOrder": "number",
   "maxChildren": "number",
   "quantitySelected": "number",
   "estimatedPriceAdult": "number",
   "estimatedPriceChild": "number",
   "ratePlans": [
    {
     "id": "string",
     "names": {
      "de": "string",
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "nl": "string",
      "ro": "string"
     },
     "mealPlans": [
      {
       "name": "string",
       "adultMealOnlyBasePrice": "number",
       "pricePerNight": "number",
       "pricePerSelectedPeriod": "number",
       "pricePerSelectedPeriodRegular": "null",
       "quantitySelected": "number"
      }
     ],
     "paymentTerms": {
      "days_before_arrival": "number",
      "installment_on_arrival_percent": "number",
      "installment_reservation_percent": "number",
      "installment_days_before_arrival_percent": "number"
     },
     "cancelationPolicy": "string",
     "outsideMinMaxStay": "boolean",
     "minStay": "null",
     "maxStay": "null",
     "unsatisfiable": "boolean",
     "withRestriction": "boolean",
     "noMealPlansOrBlocked": "boolean"
    }
   ],
   "optionsForExtraPersons": [
    {
     "all": {
      "all": {
       "AI": {
        "adult": {
         "meal": "…",
         "lodging": "…"
    
```

## `GET https://guest.hoteliera.com/api/get-hotel-availability`

```json
{
 "availability": [
  "date"
 ],
 "pricing": [
  [
   "date"
  ]
 ],
 "max_day": "date",
 "blocked_dates": [
  "date"
 ]
}
```

## `GET https://guest.hoteliera.com/api/registration-form/96905290e6b149fe847909f69cc0c7dc`

```json
{
 "reservation_id": "string",
 "org_id": "string",
 "location_id": "string",
 "slug_full": "string",
 "location_name": "string",
 "dob": "date",
 "first_name": "string",
 "last_name": "string",
 "phone": "string",
 "email": "string",
 "country_code": "string",
 "address": {
  "zip": "numeric-string",
  "city": "string",
  "county": "string",
  "country": "string",
  "address1": "string",
  "address2": "string"
 },
 "citizenship": "string",
 "day_from": "date",
 "day_to": "date",
 "trip_type": "string",
 "id_type": "string",
 "id_series": "string",
 "id_number": "string",
 "room_numbers": "string",
 "guest_images": "null",
 "meta": {
  "alias": "string",
  "language": "string",
  "trip_type": "string",
  "company_data": {
   "id": "string",
   "name": "string",
   "email": "string",
   "phone": "numeric-string",
   "address": {
    "zip": "numeric-string",
    "city": "string",
    "county": "string",
    "address1": "string"
   },
   "bank_name": "string",
   "vat_number": "null",
   "business_id": "string",
   "bank_account": "string",
   "country_code": "string",
   "business_register_no": "string"
  },
  "legal_entity": "boolean",
  "language_source": "string",
  "registration_form_sent": "string"
 },
 "document_issued_by": "string",
 "document_date": "string",
 "personal_id": "string",
 "document_required_fields": [
  "string"
 ]
}
```

## `PATCH /api/org/settings/hash`

```json
{
 "rows": [],
 "rowCount": "number",
 "allotments_are_changed": "boolean",
 "job_delayed": "boolean",
 "job_delay_minutes": "number",
 "current_hash": "string"
}
```

## `PATCH /api/org_guests/v8itxk`

```json
{
 "status": "string"
}
```

## `PATCH /api/org_guests/zaftd2`

```json
{
 "status": "string"
}
```

## `PATCH /api/reservations/qpazlsc3`

```json
{
 "status": "string",
 "rec": {
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "updated_at": "datetime",
  "updated_by": "string",
  "org_id": "string",
  "org_guest_id": "string",
  "guest_name": "string",
  "location_id": "string",
  "day_from": "date",
  "day_to": "date",
  "adults": "number",
  "children": "number",
  "rooms": "number",
  "arrival_time": "null",
  "departure_time": "null",
  "checked_in_at": "null",
  "checked_out_at": "null",
  "room_types": {},
  "room_types_persons": [],
  "room_allocation": "string",
  "arooms": [],
  "rooms_detail": [],
  "note": "null",
  "admin_note": "string",
  "status": "string",
  "tags": [
   "string"
  ],
  "notifications": [],
  "confirmations": [],
  "cancellation": "null",
  "financials": {
   "balance_due": "number",
   "total_amount_charges": "number",
   "total_amount_payments": "number"
  },
  "meta": {
   "language": "string",
   "company_data": {
    "id": "string",
    "meta": {},
    "name": "string",
    "note": "null",
    "email": "null",
    "phone": "numeric-string",
    "org_id": "string",
    "search": "string",
    "address": {
     "zip": "numeric-string",
     "city": "string",
     "county": "string",
     "address1": "string"
    },
    "archived": "boolean",
    "bank_name": "null",
    "created_at": "datetime",
    "created_by": "null",
    "updated_at": "null",
    "updated_by": "null",
    "vat_number": "null",
    "business_id": "numeric-string",
    "bank_account": "null",
    "country_code": "string",
    "business_register_no": "null",
    "associated_guests_count": "number"
   },
   "legal_entity": "boolean",
   "language_source": "string",
   "linked_reservation_ids": []
  },
  "source": "string",
  "aroom_numbers": [],
  "meal_id": "null",
  "children_ages": "null",
  "source_type": "string",
  "rules": "null",
  "ota_reservation_id": "null",
  "need_review": "null",
  "parent_id": "null",
  "guest_images": "null"
 },
 "updateMessage": {
  "changedOccupancyMessage": "string",
  "changePeriodMessage": "string",
  "roomsChangeMessage": "string"
 },
 "priceChanged": "boolean",
 "oldReservationFinancials": {},
 "paymentTermsDiffer": "boolean",
 "orgRatePlanPaymentTerms": "null",
 "currentReservationPaymentTerms": "null"
}
```

## `PATCH /api/reservations/v1ovmb6j`

```json
{
 "status": "string",
 "rec": {
  "id": "string",
  "created_at": "datetime",
  "created_by": "string",
  "updated_at": "datetime",
  "updated_by": "string",
  "org_id": "string",
  "org_guest_id": "string",
  "guest_name": "string",
  "location_id": "string",
  "day_from": "date",
  "day_to": "date",
  "adults": "number",
  "children": "number",
  "rooms": "number",
  "arrival_time": "string",
  "departure_time": "null",
  "checked_in_at": "null",
  "checked_out_at": "null",
  "room_types": {
   "doublebn3x95": "number"
  },
  "room_types_persons": [
   {
    "name": "string",
    "found": "boolean",
    "childAges": [],
    "room_type": "string",
    "uniqueKey": "string",
    "room_number": "numeric-string",
    "numberOfAdults": "number",
    "numberOfChildren": "number"
   }
  ],
  "room_allocation": "string",
  "arooms": [
   {
    "id": "string",
    "type_id": "string"
   }
  ],
  "rooms_detail": [
   {
    "id": "string",
    "number": "numeric-string",
    "type_id": "string",
    "uniqueKey": "string",
    "org_guest_id": "string"
   }
  ],
  "note": "null",
  "admin_note": "string",
  "status": "string",
  "tags": [],
  "notifications": [],
  "confirmations": [],
  "cancellation": "null",
  "financials": {
   "rate": {
    "price": "number",
    "rooms": [
     {
      "price": "number",
      "adults": "number",
      "shared": "boolean",
      "aadults": "number",
      "meal_id": "string",
      "type_id": "string",
      "children": "number",
      "achildren": "number",
      "occupancy": "number",
      "max_adults": "number",
      "max_persons": "number",
      "price_guess": "number",
      "price_total": "number",
      "extra_adults": "number",
      "max_children": "number",
      "children_ages": [],
      "price_regular": "number",
      "extra_children": "number",
      "extra_adults_total": "number",
      "extra_children_total": "number",
      "extra_adults_meal_total": "number",
      "price_without_all_taxes": "number",
      "extra_children_meal_total": "number",
      "extra_adults_lodging_total": "number",
      "extra_children_lodging_total": "number"
     }
    ],
    "rules": [],
    "taxes": [
     {
      "id": "string",
      "name": {
       "en": "string",
       "es": "string",
       "fr": "string",
       "hu": "string",
       "it": "string",
       "mk": "string",
       "ro": "string",
       "default": "string"
      },
      "amount": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_to": "string",
      "included": "boolean",
      "tax_type": "string",
      "apply_per": "string",
      "amount_price": "number",
      "amount_total": {
       "type": "string",
       "label": "string",
       "value": "number"
      },
      "apply_period": "string",
      "separate_charge": "boolean",
      "amount_price_regular": "number"
     }
    ],
    "policy": [],
    "meal_id": "string",
    "currency": "string",
    "total_tax": "number",
    "line_it
```

## `POST /api/guests/v8itxk/companies/rl07xk`

```json
{
 "success": "boolean",
 "guest": {
  "id": "string",
  "companies": [
   "string"
  ]
 }
}
```

## `POST /api/guests/zaftd2/companies/v66eac`

```json
{
 "success": "boolean",
 "guest": {
  "id": "string",
  "companies": [
   "string"
  ]
 }
}
```

## `POST /api/org_companies`

```json
{
 "id": "string",
 "created_at": "datetime",
 "created_by": "null",
 "updated_at": "null",
 "updated_by": "null",
 "org_id": "string",
 "archived": "boolean",
 "name": "string",
 "business_id": "numeric-string",
 "business_register_no": "null",
 "vat_number": "null",
 "bank_name": "null",
 "bank_account": "null",
 "phone": "numeric-string",
 "email": "null",
 "country_code": "string",
 "address": {
  "zip": "numeric-string",
  "city": "string",
  "county": "string",
  "address1": "string"
 },
 "note": "null",
 "search": "string",
 "meta": {},
 "country_name": "string"
}
```

## `POST /api/org_guests`

```json
{
 "id": "string",
 "name": "string"
}
```

## `POST /api/product`

```json
{
 "created_at": "datetime",
 "tags": [],
 "choice_ids": [],
 "addons_ids": [],
 "meta": {},
 "id": "string",
 "collection_ids": [
  "string"
 ],
 "title": {
  "en": "string"
 },
 "description": {
  "en": "string"
 },
 "sold_by": "string",
 "photos": [],
 "photo_urls": [],
 "options": [],
 "variants": [
  {
   "id": "string",
   "price": "number",
   "options": {}
  }
 ],
 "tax_ids": [
  "string"
 ],
 "upsells": [],
 "org_id": "string",
 "created_by": "string",
 "updated_at": "null",
 "updated_by": "null",
 "sku": "null",
 "unit_​​pricing_​​base_​​measure": "null",
 "location_ids": "null"
}
```

## `POST /api/public-api/generate-key`

```json
{
 "success": "boolean",
 "key": "string"
}
```

## `POST /api/reservation-price-details`

```json
{
 "id": "string",
 "start_day": "string",
 "end_day": "string",
 "offer_type": "string",
 "name": {
  "de": "string",
  "en": "string",
  "es": "string",
  "fr": "string",
  "hu": "string",
  "it": "string",
  "mk": "string",
  "nl": "string",
  "ro": "string"
 },
 "rates": [
  {
   "currency": "string",
   "meal_id": "string",
   "price_without_rules": "number",
   "price_with_rules": "number",
   "rules": [],
   "price_without_all_taxes": "number",
   "total_tax": "number",
   "line_items": [],
   "taxes": [
    {
     "id": "string",
     "name": {
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "ro": "string",
      "default": "string"
     },
     "amount": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_to": "string",
     "included": "boolean",
     "tax_type": "string",
     "apply_per": "string",
     "apply_period": "string",
     "separate_charge": "boolean",
     "amount_total": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "amount_price": "number",
     "amount_price_regular": "number"
    }
   ],
   "price": "number",
   "price_regular": "null",
   "rooms": [
    {
     "type_id": "string",
     "occupancy": "number",
     "adults": "number",
     "children": "number",
     "max_adults": "number",
     "max_children": "number",
     "max_persons": "number",
     "shared": "boolean",
     "price_guess": "number",
     "aadults": "number",
     "meal_id": "string",
     "achildren": "number",
     "extra_adults": "number",
     "extra_children": "number",
     "children_ages": [],
     "price_total": "number",
     "extra_adults_total": "number",
     "extra_children_total": "number",
     "extra_adults_lodging_total": "number",
     "extra_adults_meal_total": "number",
     "extra_children_lodging_total": "number",
     "extra_children_meal_total": "number",
     "price": "number",
     "price_regular": "number",
     "price_without_all_taxes": "number"
    }
   ],
   "price_results": [
    {
     "day": "date",
     "season": "string",
     "rate_price": [
      {
       "room_temporary_id": "string",
       "room_type_id": "string",
       "total": "number",
       "is_shared": "boolean",
       "single_discount_type": "string",
       "single_discount": "number",
       "lodging": "number",
       "meal": "number"
      }
     ],
     "extra_adult": [
      {
       "room_temporary_id": "string",
       "room_type_id": "string",
       "total": "number"
      }
     ],
     "extra_children": [],
     "rules": []
    }
   ],
   "price_per_day": [
    {
     "date": "date",
     "data": [
      {
       "room_type_id": "string",
       "price": "numeric-string"
      }
     ]
    }
   ],
   "meal_details": {
    "breakfast": {
     "provided_as": "string",
     "value": "number"
    }
   },
   "policy": [],
   "extra_adult_surcharge": {
    "lodging": "num
```

## `POST /api/reservations`

```json
{
 "id": "string"
}
```

## `POST /api/sms/logs`

```json
[]
```

## `POST /api/staff`

```json
{
 "status": "string"
}
```

## `POST https://api.rollbar.com/api/1/item/`

```json
{
 "err": "number",
 "result": {
  "id": "null",
  "uuid": "uuid"
 }
}
```

## `POST https://guest.hoteliera.com/api/locations/qaglam`

```json
{
 "org_id": "string",
 "id": "string",
 "created_at": "datetime",
 "created_by": "string",
 "created_by_name": "string",
 "updated_at": "datetime",
 "updated_by_name": "string",
 "updated_by": "string",
 "org_guest_id": "string",
 "guest_id": "null",
 "location_id": "string",
 "adults": "number",
 "children": "number",
 "children_ages": [
  "number"
 ],
 "meal_id": "string",
 "rooms": "number",
 "room_types": {
  "doubledeluxzxnb16": "number"
 },
 "room_allocation": "string",
 "rooms_detail": [
  {
   "id": "string",
   "number": "numeric-string",
   "type_id": "string",
   "uniqueKey": "string",
   "org_guest_id": "string"
  }
 ],
 "arooms": [
  {
   "id": "string",
   "type_id": "string",
   "number": "numeric-string"
  }
 ],
 "day_from": "date",
 "day_to": "date",
 "nights": "number",
 "arrival_time": "string",
 "departure_time": "null",
 "note": "null",
 "status": "string",
 "tags": [],
 "cancellation": "null",
 "notifications": [],
 "confirmations": [],
 "financials": {
  "rate": {
   "price": "number",
   "rooms": [
    {
     "price": "number",
     "adults": "number",
     "shared": "boolean",
     "aadults": "number",
     "type_id": "string",
     "children": "number",
     "achildren": "number",
     "occupancy": "number",
     "max_adults": "number",
     "max_persons": "number",
     "price_guess": "number",
     "price_total": "number",
     "extra_adults": "number",
     "max_children": "number",
     "children_ages": [],
     "price_regular": "number",
     "extra_children": "number",
     "extra_adults_total": "number",
     "extra_children_total": "number",
     "extra_adults_meal_total": "number",
     "price_without_all_taxes": "number",
     "extra_children_meal_total": "number",
     "extra_adults_lodging_total": "number",
     "extra_children_lodging_total": "number"
    }
   ],
   "rules": [],
   "taxes": [
    {
     "id": "string",
     "name": {
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "ro": "string",
      "default": "string"
     },
     "amount": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_to": "string",
     "included": "boolean",
     "tax_type": "string",
     "apply_per": "string",
     "amount_price": "number",
     "amount_total": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_period": "string",
     "separate_charge": "boolean",
     "amount_price_regular": "number"
    }
   ],
   "policy": [],
   "meal_id": "string",
   "currency": "string",
   "total_tax": "number",
   "line_items": [],
   "meal_details": "null",
   "payment_terms": {
    "days_before_arrival": "number",
    "installment_on_arrival_percent": "number",
    "installment_reservation_percent": "number",
    "installment_days_before_arrival_percent": "number"
   },
   "price_per_day": [
    {
     "data": [
      {
       "price": "numeric-string",
    
```

## `POST https://guest.hoteliera.com/api/reservation-price-details`

```json
{
 "id": "string",
 "start_day": "string",
 "end_day": "string",
 "offer_type": "string",
 "name": {
  "de": "string",
  "en": "string",
  "es": "string",
  "fr": "string",
  "hu": "string",
  "it": "string",
  "mk": "string",
  "nl": "string",
  "ro": "string"
 },
 "rates": [
  {
   "currency": "string",
   "meal_id": "string",
   "price_without_rules": "number",
   "price_with_rules": "number",
   "rules": [],
   "price_without_all_taxes": "number",
   "total_tax": "number",
   "line_items": [],
   "taxes": [
    {
     "id": "string",
     "name": {
      "en": "string",
      "es": "string",
      "fr": "string",
      "hu": "string",
      "it": "string",
      "mk": "string",
      "ro": "string",
      "default": "string"
     },
     "amount": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "apply_to": "string",
     "included": "boolean",
     "tax_type": "string",
     "apply_per": "string",
     "apply_period": "string",
     "separate_charge": "boolean",
     "amount_total": {
      "type": "string",
      "label": "string",
      "value": "number"
     },
     "amount_price": "number",
     "amount_price_regular": "number"
    }
   ],
   "price": "number",
   "price_regular": "null",
   "rooms": [
    {
     "type_id": "string",
     "occupancy": "number",
     "adults": "number",
     "children": "number",
     "max_adults": "number",
     "max_children": "number",
     "max_persons": "number",
     "shared": "boolean",
     "price_guess": "number",
     "aadults": "number",
     "meal_id": "string",
     "achildren": "number",
     "extra_adults": "number",
     "extra_children": "number",
     "children_ages": [],
     "price_total": "number",
     "extra_adults_total": "number",
     "extra_children_total": "number",
     "extra_adults_lodging_total": "number",
     "extra_adults_meal_total": "number",
     "extra_children_lodging_total": "number",
     "extra_children_meal_total": "number",
     "price": "number",
     "price_regular": "number",
     "price_without_all_taxes": "number"
    }
   ],
   "price_results": [],
   "price_per_day": [
    {
     "date": "date",
     "data": [
      {
       "room_type_id": "string",
       "price": "numeric-string"
      }
     ]
    }
   ],
   "meal_details": {
    "breakfast": {
     "provided_as": "string",
     "value": "number"
    }
   },
   "policy": [],
   "extra_adult_surcharge": {
    "lodging": "number",
    "meal": "number"
   },
   "payment_terms": {
    "days_before_arrival": "number",
    "installment_on_arrival_percent": "number",
    "installment_reservation_percent": "number",
    "installment_days_before_arrival_percent": "number"
   },
   "restriction_reservation_los_min": "number",
   "restriction_reservation_los_max": "number",
   "los_min_overridden": "boolean",
   "los_max_overridden": "boolean",
   "los_min_season_default": "number",
   "los_max_season_default": "number",
   "los_unsatisfiable": "boolean"
  }
 ],
 "grouped_
```

## `POST https://o4505171176128512.ingest.us.sentry.io/api/4510362282033152/envelope/`

```json
{}
```
