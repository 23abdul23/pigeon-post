# Sketchfab bird models to download

All were reported by the Sketchfab API as `downloadable`, `animated` and CC-BY. **Not yet opened or inspected.** On each page, check that the license is still CC BY (not NC) and that there is a flying/flapping clip before you use it. Downloads need a Sketchfab login: choose **glTF** (or GLB) in the Download dialog.

Page URL form: `https://sketchfab.com/3d-models/<uid>`

## Best bets (try these first)

| Species | Title / author | Faces | Link | Note |
|---|---|---|---|---|
| Seagull | Low-Poly Seagull (with Animation & Rigged), simonaskLDE | 580 | https://sketchfab.com/3d-models/985024328902444c8270c0f09acc897e | Tagged "flying", 6 animations |
| Pigeon | Low Poly Pigeon, hedaytul333 | 497 | https://sketchfab.com/3d-models/79de3c5b47f24376a5694029b1693088 | Description says "flapping animation" |
| Falcon | Lowpoly flying Carcará falcon, alyra004 | 430 | https://sketchfab.com/3d-models/fb5f857841b441ceb0c2ebf32ead29fb | 3 animations |
| Generic bird | Simple Bird flight, Seifert | 293 | https://sketchfab.com/3d-models/3bbf925b46a14122a192294c1e56e7dc | Very light |
| Generic bird | Bird Flying Animation, Syed Inzamam Haseen | 174 | https://sketchfab.com/3d-models/61e8ff53d4e845d5b0aeaaf39b5869ef | Lightest |

## More species

| Species | Title / author | Faces | Link |
|---|---|---|---|
| Seagull | Seagull, Dayvable ("flying seagull for distant shots") | 4,352 | https://sketchfab.com/3d-models/dc42ffc81c86480e9e7f7752fa134174 |
| Seagull | Low-Poly Seagull Animated, Jamie McFarlane | 1,078 | https://sketchfab.com/3d-models/bff3cd3d48e249e8b5afa7416c6c39f8 |
| Seagull | Seagulls animated, vicente betoret ferrero | 808 | https://sketchfab.com/3d-models/73aed843190a4dfda55f2b65cc0f8d63 |
| Dove | Mourning Dove - in Flight, osuecampus | 3,172 | https://sketchfab.com/3d-models/37f9b2cc8b174fc3a2d8ba9f5b467b1a |
| Sparrow | Song Sparrow - in Flight, osuecampus | 3,352 | https://sketchfab.com/3d-models/1617172435ed42cbbf2d410450398f85 |
| Robin | American Robin - in Flight, osuecampus | 2,684 | https://sketchfab.com/3d-models/4e3e84b695114d55a2845407409fad55 |
| Goose | Canada Goose - in Flight, osuecampus | 3,354 | https://sketchfab.com/3d-models/25fbbb9e607a4bccb05ae05c08fd0039 |
| Hawk | Red-tailed Hawk - in Flight, osuecampus | 3,892 | https://sketchfab.com/3d-models/4abcab5af9044a939fb5a55bff9e5000 |
| Eagle | White Eagle Animation Fast Fly, GremorySaiyan | 3,128 | https://sketchfab.com/3d-models/30203bf39e5145f19c79e83c550139d3 |
| Eagle | Animated Eagle, noyou | 3,858 | https://sketchfab.com/3d-models/cd2a2d7fe1134a40a4fe65eb422fe736 |
| Owl | Owl, smart1llc ("owl flying is cool") | 3,394 | https://sketchfab.com/3d-models/ff30f2fdb2644f19ab6de5a3a3989e48 |
| Owl | Owl, po (9 animations incl. fly; heavy) | 15,428 | https://sketchfab.com/3d-models/d177e1fbcce940cba32e434cc5a62f1a |
| Hummingbird | LowPoly humming-bird animated, alexi.smnd | 2,032 | https://sketchfab.com/3d-models/abc35c5c30fc44c282188c3065a6daf0 |
| Hummingbird | Flying Hummingbird, jackie glade (higher poly) | 7,429 | https://sketchfab.com/3d-models/4c308142b6e146e892582b9c6025a92d |
| Crow | crow_fly, tech.service.allwe | 2,340 | https://sketchfab.com/3d-models/7d926019e3d34041b872a01b6fdd141c |
| Crow | Crow Ascend, Lahcen.el | 1,606 | https://sketchfab.com/3d-models/e2e6d407b18547d2a9ed37a1707042e1 |
| Generic bird | Bird Flying Animation, Rukh3D | 1,178 | https://sketchfab.com/3d-models/c221ef6d36024feab16f4f43f4974bbb |

The osuecampus sparrow, robin, goose and hawk have no description, so "in Flight" in the title is the only evidence they fly.

## Search pages (for species not listed: swallow, tern, duck, crane, heron, owl, pelican...)

https://sketchfab.com/search?features=downloadable&type=models&q=flying+bird&animated=true

Swap `q=` for the species name.

## After downloading

1. Drop the `.glb` in `public/models/` (a `.gltf` with `.bin` and textures works too, but a single glb is simpler).
2. Tell me the file names and I'll add them to `src/lib/birds.ts`, compress the textures, and fix the facing direction.

## Attribution (CC BY requires it)

Credit line for each model used: `<Title> by <Author> (<page URL>), licensed under CC BY 4.0` (confirm 3.0 vs 4.0 on the model page).
