# Документація Channex — збережена копія

**Знято 30 серпня 2026** з `docs.channex.io`. 111 сторінок + Postman-колекція.

## Навіщо це в репозиторії

Прочитана й переказана сторінка застаріває мовчки. Збережена — показує diff.

Ця тека — **фікстура, а не читання**: кожне твердження в
[docs/CHANNEX-INTEGRATION.md](../../CHANNEX-INTEGRATION.md) і в
[INVENTORY.md](INVENTORY.md) можна перевірити `grep`-ом, а не пам'яттю. Коли
Channex щось змінить, повторне зняття покаже, що саме — і які наші рішення
на цьому трималися.

## Як знімалося

Channex віддає markdown-версію будь-якої сторінки, якщо додати `.md` до URL,
а `llms.txt` є повним індексом. Обидва перевірені.

```bash
curl -sS https://docs.channex.io/llms.txt -o docs/vendor/channex/llms.txt
grep -o 'https://docs\.channex\.io/[^)]*\.md' docs/vendor/channex/llms.txt | sort -u |
while read -r url; do
  rel="${url#https://docs.channex.io/}"
  # Вендорський readme.md і наш README.md — ОДИН файл на Windows і macOS.
  # Без цього рядка перезняття мовчки затирає опис теки, і робоча копія
  # ніколи не буває чистою. На Linux-CI не видно взагалі.
  [ "$rel" = "readme.md" ] && rel="vendor-readme.md"
  mkdir -p "docs/vendor/channex/$(dirname "$rel")"
  curl -sS --retry 2 "$url" -o "docs/vendor/channex/$rel"
done
```

Postman-колекція лежить за іншим хостом, і головний
(`documenter.gw.postman.com`) заблокований егрес-проксі. Робочий шлях —
через `documenter.getpostman.com`:

```bash
curl -sS 'https://documenter.getpostman.com/api/collections/681982/RztkPpne?environment=681982-185534ef-0c9f-455c-9d38-f97df74f64e4&segregateAuth=true&versionTag=latest' \
  | python3 -m json.tool > docs/vendor/channex/postman-collection.json
```

## Що всередині

| Тека | Сторінок | Про що |
|---|---|---|
| `api-v.1-documentation/` | 28 | API: колекції об'єктів, ARI, вебхуки, бронювання, ліміти, iFrame |
| `channel-mapping-guides/` | 36 | як підключається кожен канал — **інтерфейсом**, очима готелю |
| `channel-api-examples/` | 19 | як підключається кожен канал — **через API** |
| `application-documentation/` | 12 | власна адмінка Channex: саме її показує iFrame |
| `guides/` | 6 | інтеграція PMS, найкращі практики, PCI, ретенція, тестові акаунти |
| `for-ota/` | 3 | бік OTA — нам не потрібно, збережено для повноти |
| `app-guide/`, `google/` | 4 | Apaleo, PCI-застосунок, Google-канали |
| `postman-collection.json` | 95 запитів | 19 тек, назви й тіла запитів |

## Правила користування

1. **Не редагувати.** Це копія чужого тексту. Виправлення йдуть у наші
   документи з посиланням сюди.
2. **Наші висновки — не тут.** Факти — в [INVENTORY.md](INVENTORY.md),
   рішення — в [CHANNEX-INTEGRATION.md](../../CHANNEX-INTEGRATION.md).
3. **Оновлення — повним перезняттям** тими самими командами, окремим
   комітом, без змішування з кодом. Тоді diff читається.
4. **Жодних двох шляхів, що різняться лише регістром.** Вендорська головна
   сторінка лежить як `vendor-readme.md`, не `readme.md`: інакше вона і цей
   файл — один файл на файловій системі власника, і git ніколи не покаже теку
   чистою. Клас стереже гейт `check-case-collisions`.
