# Maison YoRa Custom Pieces — Google Sheet Setup

The website now manages the custom-product builder from two Google Sheet tabs.

## 1. CustomProducts

Use these exact column names:

| product_id | product_name | base_price | active | sort_order | description |
|---|---|---:|---|---:|---|
| CUSTOM_CANDLE | Custom Candle | 75 | TRUE | 1 | Design your own sculpted floral candle |
| FLOWER_BOUQUET | Custom Flower Bouquet | 95 | TRUE | 2 | Create a custom floral candle bouquet |

## 2. CustomOptions

Use these exact column names:

| product_id | category | option | price_adjustment | active | sort_order | description |
|---|---|---|---:|---|---:|---|
| CUSTOM_CANDLE | Bloom | Rose | 0 | TRUE | 1 | Classic rose |
| CUSTOM_CANDLE | Bloom | Peony | 5 | TRUE | 2 | Layered peony |
| CUSTOM_CANDLE | Colour | Ivory White | 0 | TRUE | 1 | Soft ivory |
| CUSTOM_CANDLE | Scent | Garden Rose & White Musk | 0 | TRUE | 1 | Floral musk |
| FLOWER_BOUQUET | Size | Small | 0 | TRUE | 1 | Petite arrangement |
| FLOWER_BOUQUET | Size | Medium | 25 | TRUE | 2 | Standard bouquet |
| FLOWER_BOUQUET | Flower Palette | Ivory & Blush | 0 | TRUE | 1 | Soft neutral palette |
| FLOWER_BOUQUET | Scent | Champagne Rose | 5 | TRUE | 1 | Rose profile |
| FLOWER_BOUQUET | Packaging | Signature Wrap | 0 | TRUE | 1 | Standard presentation |
| FLOWER_BOUQUET | Packaging | Luxury Gift Box | 15 | TRUE | 2 | Premium gift packaging |

## Pricing

Customer price = base_price + all selected price_adjustment values.

The displayed price updates immediately on the website. At Stripe checkout, the Netlify function re-reads the Google Sheet and recalculates the price server-side.

## Managing the website without editing GitHub

- Change `base_price` to update the starting price.
- Change `price_adjustment` to update an option surcharge.
- Add a row to create a new option.
- Set `active` to FALSE to hide an option or product.
- Change `sort_order` to change display order.
- Add a completely new category (for example `Vessel`) and it will automatically appear as another dropdown for that product.
