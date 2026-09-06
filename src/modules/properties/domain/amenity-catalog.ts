/**
 * Стартовий каталог зручностей — те, з чого починає КОЖЕН новий готель.
 *
 * ── Чому в коді, а не в базі ────────────────────────────────────────────
 *
 * Це не дані клієнта, а словник продукту: коди, на які мапиться канал і
 * якими розмовляють сайт із гостьовою сторінкою. Дані клієнта — те, ЩО він
 * позначив у себе (`property_amenities`, `unit_type_amenities`), і його
 * власні зручності понад цей список, які він заводить сам.
 *
 * Тобто інваріант 20 не порушено: у коді немає жодної назви, ціни чи
 * ідентифікатора конкретного готелю — лише загальні слова, які однакові в
 * будь-якому місті.
 *
 * ── Область (`scope`) — не косметика ────────────────────────────────────
 *
 * Ліфт буває в будинку, фен — у номері, сніданок у номер — і там, і там.
 * Джерело форми (Hoteliera, `org-settings-amenities`) позначає це `L`, `R`,
 * `L+R`, і саме цим полем матриця призначення відрізняє «можна повісити на
 * обʼєкт» від «можна на тип номера». Без нього перелік на 40 позицій
 * однаковий обабіч, і готель повісить ліфт на двомісний номер.
 *
 * ── Назви всіма сімома мовами заведення ─────────────────────────────────
 *
 * Готель отримує каталог СВОЄЮ мовою (як `defaultBookingSources`): рядок у
 * базі один, і його можна перейменувати. Мова гостя — інша річ: гостьова
 * сторінка перекладає вміст своїм шляхом, і `code` тут саме для того, щоб
 * переклад не залежав від того, як готель назвав рядок у себе.
 *
 * `provision-org.mjs` приймає сім мов (`uk en de cs pl nl fr`) — і рівно ці
 * сім тут є (рішення власника 07.09). Перша редакція мала чотири (uk, cs, de
 * і en запасною), і це було свідоме обмеження, записане в О5; власник його
 * зняв, бо ціна зволікання нерівномірна: **засів одноразовий**, тож
 * польський готель, заведений до перекладу, лишився б з англійськими рядками
 * доти, доки хтось не перейменує їх руками — по одному, у своїй базі.
 *
 * `en` лишається запасною для мови поза сімкою (`amenityName` нижче):
 * італійський готель побачить «Elevator», а не «Ліфт» — незнайому мову, а не
 * мову, якої в його світі немає взагалі.
 *
 * Наступна мова додається сюди рядком, без міграції; повноту (кожен рядок ×
 * кожна мова) тримає `amenities.repo.check`.
 */

export type AmenityScope = 'property' | 'unit_type' | 'both';

/**
 * Мови, якими заводиться готель, — рівно ті, що приймає `provision-org.mjs`.
 *
 * Перелік окремою константою, бо його читає перевірка повноти: інакше «сім
 * мов» — це те, що видно з форми типу, а не те, що хтось міряв.
 */
export const CATALOG_LANGUAGES = ['uk', 'en', 'de', 'cs', 'pl', 'nl', 'fr'] as const;

/** Кожна мова заведення — обовʼязкова; `en` слугує запасною для решти світу. */
export interface AmenityNames { uk: string; cs: string; de: string; en: string; pl: string; nl: string; fr: string }

export interface AmenityCategorySeed {
  code: string;
  name: AmenityNames;
  sortOrder: number;
}

export interface AmenitySeed {
  code: string;
  category: string;
  scope: AmenityScope;
  icon?: string;
  name: AmenityNames;
}

export const AMENITY_CATEGORIES: AmenityCategorySeed[] = [
  { code: 'general', sortOrder: 1, name: { uk: 'Загальне', cs: 'Obecné', de: 'Allgemein', en: 'General', pl: 'Ogólne', nl: 'Algemeen', fr: 'Général' } },
  { code: 'room', sortOrder: 2, name: { uk: 'У номері', cs: 'Na pokoji', de: 'Im Zimmer', en: 'In the room', pl: 'W pokoju', nl: 'Op de kamer', fr: 'Dans la chambre' } },
  { code: 'bathroom', sortOrder: 3, name: { uk: 'Ванна кімната', cs: 'Koupelna', de: 'Badezimmer', en: 'Bathroom', pl: 'Łazienka', nl: 'Badkamer', fr: 'Salle de bains' } },
  { code: 'food', sortOrder: 4, name: { uk: 'Їжа й напої', cs: 'Jídlo a nápoje', de: 'Essen und Trinken', en: 'Food and drink', pl: 'Jedzenie i napoje', nl: 'Eten en drinken', fr: 'Restauration' } },
  { code: 'internet', sortOrder: 5, name: { uk: 'Інтернет', cs: 'Internet', de: 'Internet', en: 'Internet', pl: 'Internet', nl: 'Internet', fr: 'Internet' } },
  { code: 'parking', sortOrder: 6, name: { uk: 'Паркування', cs: 'Parkování', de: 'Parken', en: 'Parking', pl: 'Parking', nl: 'Parkeren', fr: 'Stationnement' } },
  { code: 'services', sortOrder: 7, name: { uk: 'Послуги', cs: 'Služby', de: 'Services', en: 'Services', pl: 'Usługi', nl: 'Diensten', fr: 'Services' } },
  { code: 'wellness', sortOrder: 8, name: { uk: 'Спа й велнес', cs: 'Spa a wellness', de: 'Spa und Wellness', en: 'Spa and wellness', pl: 'Spa i wellness', nl: 'Spa en wellness', fr: 'Spa et bien-être' } },
  { code: 'family', sortOrder: 9, name: { uk: 'Родина й дозвілля', cs: 'Rodina a zábava', de: 'Familie und Freizeit', en: 'Family and leisure', pl: 'Rodzina i rozrywka', nl: 'Gezin en ontspanning', fr: 'Famille et loisirs' } },
  { code: 'safety', sortOrder: 10, name: { uk: 'Безпека', cs: 'Bezpečnost', de: 'Sicherheit', en: 'Safety', pl: 'Bezpieczeństwo', nl: 'Veiligheid', fr: 'Sécurité' } },
  { code: 'outdoors', sortOrder: 11, name: { uk: 'Надворі', cs: 'Venku', de: 'Außenbereich', en: 'Outdoors', pl: 'Na zewnątrz', nl: 'Buiten', fr: 'Extérieur' } },
  { code: 'view', sortOrder: 12, name: { uk: 'Вид', cs: 'Výhled', de: 'Ausblick', en: 'View', pl: 'Widok', nl: 'Uitzicht', fr: 'Vue' } },
];

/**
 * Сорок позицій, а не сто пʼятдесят п'ять.
 *
 * Довший перелік не робить готель повнішим — він робить екран, на якому
 * нічого не позначено, бо позначати його ніхто не сідає. Те, чого тут немає,
 * готель додає сам однією кнопкою; те, що є, покриває звичайний європейський
 * готель і всі поля, які питає канал.
 */
export const AMENITIES: AmenitySeed[] = [
  // Загальне — про будинок
  { code: 'air_conditioning', category: 'general', scope: 'both', icon: 'wind', name: { uk: 'Кондиціонер', cs: 'Klimatizace', de: 'Klimaanlage', en: 'Air conditioning', pl: 'Klimatyzacja', nl: 'Airconditioning', fr: 'Climatisation' } },
  { code: 'heating', category: 'general', scope: 'both', icon: 'thermometer', name: { uk: 'Опалення', cs: 'Topení', de: 'Heizung', en: 'Heating', pl: 'Ogrzewanie', nl: 'Verwarming', fr: 'Chauffage' } },
  { code: 'elevator', category: 'general', scope: 'property', icon: 'chevrons-up', name: { uk: 'Ліфт', cs: 'Výtah', de: 'Aufzug', en: 'Elevator', pl: 'Winda', nl: 'Lift', fr: 'Ascenseur' } },
  { code: 'non_smoking', category: 'general', scope: 'both', icon: 'ban', name: { uk: 'Для некурців', cs: 'Nekuřácké', de: 'Nichtraucher', en: 'Non-smoking', pl: 'Dla niepalących', nl: 'Rookvrij', fr: 'Non-fumeur' } },
  { code: 'family_rooms', category: 'general', scope: 'both', icon: 'users', name: { uk: 'Сімейні номери', cs: 'Rodinné pokoje', de: 'Familienzimmer', en: 'Family rooms', pl: 'Pokoje rodzinne', nl: 'Gezinskamers', fr: 'Chambres familiales' } },
  { code: 'accessible', category: 'general', scope: 'both', icon: 'accessibility', name: { uk: 'Доступно для людей з інвалідністю', cs: 'Bezbariérový přístup', de: 'Barrierefrei', en: 'Accessible', pl: 'Dostępne dla osób z niepełnosprawnościami', nl: 'Toegankelijk voor mindervaliden', fr: 'Accessible aux personnes handicapées' } },
  { code: 'pets_allowed', category: 'general', scope: 'both', icon: 'paw-print', name: { uk: 'Можна з тваринами', cs: 'Domácí mazlíčci povoleni', de: 'Haustiere erlaubt', en: 'Pets allowed', pl: 'Zwierzęta dozwolone', nl: 'Huisdieren toegestaan', fr: 'Animaux acceptés' } },

  // У номері
  { code: 'tv', category: 'room', scope: 'unit_type', icon: 'tv', name: { uk: 'Телевізор', cs: 'Televize', de: 'Fernseher', en: 'TV', pl: 'Telewizor', nl: 'Televisie', fr: 'Télévision' } },
  { code: 'minibar', category: 'room', scope: 'unit_type', icon: 'wine', name: { uk: 'Мінібар', cs: 'Minibar', de: 'Minibar', en: 'Minibar', pl: 'Minibar', nl: 'Minibar', fr: 'Minibar' } },
  { code: 'safe', category: 'room', scope: 'unit_type', icon: 'lock', name: { uk: 'Сейф', cs: 'Trezor', de: 'Safe', en: 'Safe', pl: 'Sejf', nl: 'Kluis', fr: 'Coffre-fort' } },
  { code: 'desk', category: 'room', scope: 'unit_type', icon: 'lamp-desk', name: { uk: 'Робочий стіл', cs: 'Pracovní stůl', de: 'Schreibtisch', en: 'Desk', pl: 'Biurko', nl: 'Bureau', fr: 'Bureau' } },
  { code: 'wardrobe', category: 'room', scope: 'unit_type', icon: 'shirt', name: { uk: 'Шафа', cs: 'Šatní skříň', de: 'Kleiderschrank', en: 'Wardrobe', pl: 'Szafa', nl: 'Kledingkast', fr: 'Armoire' } },
  { code: 'kettle', category: 'room', scope: 'unit_type', icon: 'coffee', name: { uk: 'Електрочайник', cs: 'Rychlovarná konvice', de: 'Wasserkocher', en: 'Electric kettle', pl: 'Czajnik elektryczny', nl: 'Waterkoker', fr: 'Bouilloire électrique' } },
  { code: 'coffee_maker', category: 'room', scope: 'unit_type', icon: 'coffee', name: { uk: 'Кавоварка', cs: 'Kávovar', de: 'Kaffeemaschine', en: 'Coffee maker', pl: 'Ekspres do kawy', nl: 'Koffiezetapparaat', fr: 'Machine à café' } },
  { code: 'balcony', category: 'room', scope: 'unit_type', icon: 'door-open', name: { uk: 'Балкон', cs: 'Balkon', de: 'Balkon', en: 'Balcony', pl: 'Balkon', nl: 'Balkon', fr: 'Balcon' } },
  { code: 'terrace', category: 'room', scope: 'unit_type', icon: 'sun', name: { uk: 'Тераса', cs: 'Terasa', de: 'Terrasse', en: 'Terrace', pl: 'Taras', nl: 'Terras', fr: 'Terrasse' } },
  { code: 'kitchenette', category: 'room', scope: 'unit_type', icon: 'cooking-pot', name: { uk: 'Кухонний куток', cs: 'Kuchyňský kout', de: 'Küchenzeile', en: 'Kitchenette', pl: 'Aneks kuchenny', nl: 'Kitchenette', fr: 'Kitchenette' } },
  { code: 'blackout_curtains', category: 'room', scope: 'unit_type', icon: 'moon', name: { uk: 'Затемнювальні штори', cs: 'Zatemňovací závěsy', de: 'Verdunkelungsvorhänge', en: 'Blackout curtains', pl: 'Zasłony zaciemniające', nl: 'Verduisterende gordijnen', fr: 'Rideaux occultants' } },
  { code: 'soundproof', category: 'room', scope: 'unit_type', icon: 'volume-x', name: { uk: 'Звукоізоляція', cs: 'Zvuková izolace', de: 'Schallschutz', en: 'Soundproofing', pl: 'Izolacja akustyczna', nl: 'Geluidsisolatie', fr: 'Insonorisation' } },

  // Ванна
  { code: 'private_bathroom', category: 'bathroom', scope: 'unit_type', icon: 'bath', name: { uk: 'Власна ванна кімната', cs: 'Vlastní koupelna', de: 'Eigenes Bad', en: 'Private bathroom', pl: 'Własna łazienka', nl: 'Eigen badkamer', fr: 'Salle de bains privative' } },
  { code: 'shower', category: 'bathroom', scope: 'unit_type', icon: 'shower-head', name: { uk: 'Душ', cs: 'Sprcha', de: 'Dusche', en: 'Shower', pl: 'Prysznic', nl: 'Douche', fr: 'Douche' } },
  { code: 'bathtub', category: 'bathroom', scope: 'unit_type', icon: 'bath', name: { uk: 'Ванна', cs: 'Vana', de: 'Badewanne', en: 'Bathtub', pl: 'Wanna', nl: 'Bad', fr: 'Baignoire' } },
  { code: 'hair_dryer', category: 'bathroom', scope: 'unit_type', icon: 'wind', name: { uk: 'Фен', cs: 'Fén', de: 'Haartrockner', en: 'Hair dryer', pl: 'Suszarka do włosów', nl: 'Haardroger', fr: 'Sèche-cheveux' } },
  { code: 'toiletries', category: 'bathroom', scope: 'unit_type', icon: 'droplets', name: { uk: 'Засоби гігієни', cs: 'Hygienické potřeby', de: 'Pflegeprodukte', en: 'Toiletries', pl: 'Kosmetyki', nl: 'Toiletartikelen', fr: 'Articles de toilette' } },
  { code: 'towels', category: 'bathroom', scope: 'unit_type', icon: 'layers', name: { uk: 'Рушники', cs: 'Ručníky', de: 'Handtücher', en: 'Towels', pl: 'Ręczniki', nl: 'Handdoeken', fr: 'Serviettes' } },

  // Їжа й напої
  { code: 'restaurant', category: 'food', scope: 'property', icon: 'utensils', name: { uk: 'Ресторан', cs: 'Restaurace', de: 'Restaurant', en: 'Restaurant', pl: 'Restauracja', nl: 'Restaurant', fr: 'Restaurant' } },
  { code: 'bar', category: 'food', scope: 'property', icon: 'martini', name: { uk: 'Бар', cs: 'Bar', de: 'Bar', en: 'Bar', pl: 'Bar', nl: 'Bar', fr: 'Bar' } },
  { code: 'breakfast', category: 'food', scope: 'both', icon: 'croissant', name: { uk: 'Сніданок', cs: 'Snídaně', de: 'Frühstück', en: 'Breakfast', pl: 'Śniadanie', nl: 'Ontbijt', fr: 'Petit-déjeuner' } },
  { code: 'room_service', category: 'food', scope: 'both', icon: 'bell-ring', name: { uk: 'Обслуговування в номері', cs: 'Pokojová služba', de: 'Zimmerservice', en: 'Room service', pl: 'Obsługa pokoju', nl: 'Roomservice', fr: 'Service en chambre' } },

  // Інтернет
  { code: 'wifi_free', category: 'internet', scope: 'both', icon: 'wifi', name: { uk: 'Безкоштовний Wi-Fi', cs: 'Wi-Fi zdarma', de: 'WLAN kostenlos', en: 'Free Wi-Fi', pl: 'Bezpłatne Wi-Fi', nl: 'Gratis wifi', fr: 'Wi-Fi gratuit' } },
  { code: 'wifi_public_areas', category: 'internet', scope: 'property', icon: 'wifi', name: { uk: 'Wi-Fi у спільних зонах', cs: 'Wi-Fi ve společných prostorách', de: 'WLAN in öffentlichen Bereichen', en: 'Wi-Fi in public areas', pl: 'Wi-Fi w częściach wspólnych', nl: 'Wifi in openbare ruimten', fr: 'Wi-Fi dans les parties communes' } },

  // Паркування
  { code: 'parking_free', category: 'parking', scope: 'property', icon: 'circle-parking', name: { uk: 'Безкоштовна парковка', cs: 'Parkování zdarma', de: 'Kostenlose Parkplätze', en: 'Free parking', pl: 'Bezpłatny parking', nl: 'Gratis parkeren', fr: 'Parking gratuit' } },
  { code: 'parking_paid', category: 'parking', scope: 'property', icon: 'circle-parking', name: { uk: 'Платна парковка', cs: 'Placené parkování', de: 'Kostenpflichtige Parkplätze', en: 'Paid parking', pl: 'Płatny parking', nl: 'Betaald parkeren', fr: 'Parking payant' } },
  { code: 'garage', category: 'parking', scope: 'property', icon: 'warehouse', name: { uk: 'Гараж', cs: 'Garáž', de: 'Garage', en: 'Garage', pl: 'Garaż', nl: 'Garage', fr: 'Garage' } },
  { code: 'ev_charging', category: 'parking', scope: 'property', icon: 'plug-zap', name: { uk: 'Зарядка для електромобіля', cs: 'Nabíjení elektromobilů', de: 'E-Auto-Ladestation', en: 'EV charging station', pl: 'Ładowarka do aut elektrycznych', nl: 'Laadpunt voor elektrische auto', fr: 'Borne de recharge électrique' } },

  // Послуги
  { code: 'front_desk_24h', category: 'services', scope: 'property', icon: 'concierge-bell', name: { uk: 'Цілодобова рецепція', cs: 'Nonstop recepce', de: 'Rezeption rund um die Uhr', en: '24-hour front desk', pl: 'Całodobowa recepcja', nl: '24-uursreceptie', fr: 'Réception ouverte 24h/24' } },
  { code: 'daily_housekeeping', category: 'services', scope: 'both', icon: 'brush-cleaning', name: { uk: 'Щоденне прибирання', cs: 'Denní úklid', de: 'Tägliche Reinigung', en: 'Daily housekeeping', pl: 'Codzienne sprzątanie', nl: 'Dagelijkse schoonmaak', fr: 'Ménage quotidien' } },
  { code: 'laundry', category: 'services', scope: 'both', icon: 'washing-machine', name: { uk: 'Пральня', cs: 'Prádelna', de: 'Wäscheservice', en: 'Laundry', pl: 'Pralnia', nl: 'Wasserij', fr: 'Blanchisserie' } },
  { code: 'luggage_storage', category: 'services', scope: 'property', icon: 'luggage', name: { uk: 'Камера схову', cs: 'Úschovna zavazadel', de: 'Gepäckaufbewahrung', en: 'Luggage storage', pl: 'Przechowalnia bagażu', nl: 'Bagageopslag', fr: 'Consigne à bagages' } },
  { code: 'airport_shuttle', category: 'services', scope: 'property', icon: 'bus', name: { uk: 'Трансфер з аеропорту', cs: 'Kyvadlová doprava na letiště', de: 'Flughafentransfer', en: 'Airport shuttle', pl: 'Transfer z lotniska', nl: 'Luchthavenshuttle', fr: 'Navette aéroport' } },

  // Спа й велнес
  { code: 'sauna', category: 'wellness', scope: 'property', icon: 'flame', name: { uk: 'Сауна', cs: 'Sauna', de: 'Sauna', en: 'Sauna', pl: 'Sauna', nl: 'Sauna', fr: 'Sauna' } },
  { code: 'spa', category: 'wellness', scope: 'property', icon: 'sparkles', name: { uk: 'Спа', cs: 'Spa', de: 'Spa', en: 'Spa', pl: 'Spa', nl: 'Spa', fr: 'Spa' } },
  { code: 'hot_tub', category: 'wellness', scope: 'property', icon: 'waves', name: { uk: 'Купіль', cs: 'Vířivka', de: 'Whirlpool', en: 'Hot tub', pl: 'Jacuzzi', nl: 'Bubbelbad', fr: 'Bain à remous' } },
  { code: 'fitness', category: 'wellness', scope: 'property', icon: 'dumbbell', name: { uk: 'Тренажерний зал', cs: 'Fitness', de: 'Fitnessraum', en: 'Fitness centre', pl: 'Siłownia', nl: 'Fitnessruimte', fr: 'Salle de sport' } },
  { code: 'pool', category: 'wellness', scope: 'property', icon: 'waves', name: { uk: 'Басейн', cs: 'Bazén', de: 'Swimmingpool', en: 'Swimming pool', pl: 'Basen', nl: 'Zwembad', fr: 'Piscine' } },

  // Родина й дозвілля
  { code: 'playground', category: 'family', scope: 'property', icon: 'baby', name: { uk: 'Дитячий майданчик', cs: 'Dětské hřiště', de: 'Spielplatz', en: 'Playground', pl: 'Plac zabaw', nl: 'Speeltuin', fr: 'Aire de jeux' } },
  { code: 'board_games', category: 'family', scope: 'both', icon: 'dices', name: { uk: 'Настільні ігри', cs: 'Společenské hry', de: 'Gesellschaftsspiele', en: 'Board games', pl: 'Gry planszowe', nl: 'Gezelschapsspellen', fr: 'Jeux de société' } },
  { code: 'bicycle_rental', category: 'family', scope: 'property', icon: 'bike', name: { uk: 'Прокат велосипедів', cs: 'Půjčovna kol', de: 'Fahrradverleih', en: 'Bicycle rental', pl: 'Wypożyczalnia rowerów', nl: 'Fietsverhuur', fr: 'Location de vélos' } },
  { code: 'ski_storage', category: 'family', scope: 'property', icon: 'snowflake', name: { uk: 'Лижна кімната', cs: 'Lyžárna', de: 'Skiraum', en: 'Ski storage', pl: 'Przechowalnia nart', nl: 'Skiberging', fr: 'Local à skis' } },

  // Безпека
  { code: 'smoke_alarm', category: 'safety', scope: 'both', icon: 'siren', name: { uk: 'Датчик диму', cs: 'Detektor kouře', de: 'Rauchmelder', en: 'Smoke alarm', pl: 'Czujnik dymu', nl: 'Rookmelder', fr: 'Détecteur de fumée' } },
  { code: 'key_card_access', category: 'safety', scope: 'both', icon: 'key-round', name: { uk: 'Вхід за карткою', cs: 'Přístup na kartu', de: 'Schlüsselkartenzugang', en: 'Key card access', pl: 'Wejście na kartę', nl: 'Toegang met keycard', fr: 'Accès par carte' } },
  { code: 'cctv', category: 'safety', scope: 'property', icon: 'cctv', name: { uk: 'Відеоспостереження', cs: 'Kamerový systém', de: 'Videoüberwachung', en: 'CCTV', pl: 'Monitoring', nl: 'Camerabewaking', fr: 'Vidéosurveillance' } },
  { code: 'first_aid_kit', category: 'safety', scope: 'property', icon: 'briefcase-medical', name: { uk: 'Аптечка', cs: 'Lékárnička', de: 'Erste-Hilfe-Kasten', en: 'First aid kit', pl: 'Apteczka', nl: 'EHBO-kit', fr: 'Trousse de premiers secours' } },

  // Надворі
  { code: 'garden', category: 'outdoors', scope: 'property', icon: 'trees', name: { uk: 'Сад', cs: 'Zahrada', de: 'Garten', en: 'Garden', pl: 'Ogród', nl: 'Tuin', fr: 'Jardin' } },
  { code: 'sun_terrace', category: 'outdoors', scope: 'property', icon: 'sun', name: { uk: 'Тераса для засмаги', cs: 'Sluneční terasa', de: 'Sonnenterrasse', en: 'Sun terrace', pl: 'Taras słoneczny', nl: 'Zonneterras', fr: 'Terrasse ensoleillée' } },
  { code: 'bbq', category: 'outdoors', scope: 'property', icon: 'flame', name: { uk: 'Місце для барбекю', cs: 'Gril', de: 'Grillplatz', en: 'BBQ facilities', pl: 'Miejsce na grilla', nl: 'Barbecuefaciliteiten', fr: 'Espace barbecue' } },

  // Вид — той самий словник, яким OTA описує номер (О1)
  { code: 'sea_view', category: 'view', scope: 'unit_type', icon: 'waves', name: { uk: 'Вид на море', cs: 'Výhled na moře', de: 'Meerblick', en: 'Sea view', pl: 'Widok na morze', nl: 'Zeezicht', fr: 'Vue sur la mer' } },
  { code: 'mountain_view', category: 'view', scope: 'unit_type', icon: 'mountain', name: { uk: 'Вид на гори', cs: 'Výhled na hory', de: 'Bergblick', en: 'Mountain view', pl: 'Widok na góry', nl: 'Bergzicht', fr: 'Vue sur la montagne' } },
  { code: 'garden_view', category: 'view', scope: 'unit_type', icon: 'trees', name: { uk: 'Вид на сад', cs: 'Výhled do zahrady', de: 'Gartenblick', en: 'Garden view', pl: 'Widok na ogród', nl: 'Tuinzicht', fr: 'Vue sur le jardin' } },
  { code: 'city_view', category: 'view', scope: 'unit_type', icon: 'building', name: { uk: 'Вид на місто', cs: 'Výhled na město', de: 'Stadtblick', en: 'City view', pl: 'Widok na miasto', nl: 'Uitzicht op de stad', fr: 'Vue sur la ville' } },
  { code: 'courtyard_view', category: 'view', scope: 'unit_type', icon: 'square', name: { uk: 'Вид у двір', cs: 'Výhled do dvora', de: 'Hofblick', en: 'Courtyard view', pl: 'Widok na dziedziniec', nl: 'Uitzicht op de binnenplaats', fr: 'Vue sur la cour' } },
];

/**
 * Назва мовою готелю; мова без перекладу падає на АНГЛІЙСЬКУ, не на українську.
 *
 * Запасна українська означала б, що польський чи французький готель відкриває
 * екран і бачить кирилицю — мову, якої в його світі немає взагалі. Англійська
 * тут читається як «переклад ще не зробили», і це чесно.
 */
export function amenityName(seed: { name: AmenityNames }, language: string): string {
  const byLang = seed.name as unknown as Record<string, string | undefined>;
  return byLang[language] ?? seed.name.en;
}

/** Область каже, куди зручність МОЖНА повісити. */
export function scopeAllows(scope: AmenityScope, target: 'property' | 'unit_type'): boolean {
  return scope === 'both' || scope === target;
}
