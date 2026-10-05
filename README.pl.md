# Space Bunny

**Wystrzel bezwładnego królika ze szklanej kuli, łap gwiazdy i wyślij go w kosmos.**
Przytulna, pastelowa gra przeglądarkowa w stylu low-poly: pociągnij królika do tyłu, puść i patrz, jak miękka, bezwładna maskotka wylatuje ze swojego terrarium w nieznane.

**[▶ Zagraj teraz](https://agata-c.github.io/space-bunny/)** · [English](README.md)

[🎬 Obejrzyj 13-sekundowe demo](docs/demo.mp4)

---

## Pomysł

Zrobiłam tę grę, żeby zrobić jedną rzecz: **wystrzelić królika w kosmos.** W pierwszym prototypie najlepszy był moment, w którym królik wylatuje ze szklanej kuli w nieznane, więc cała gra jest zbudowana wokół niego.

Wszystko, co widzisz, od szklanej kuli po ostatnią gwiazdę, jest wygenerowane w kodzie: nie ma tu modeli 3D ani tekstur. Jedyne pliki to efekty dźwiękowe, które zrobiłam w Suno, oraz obrazek do udostępniania.

## Jak grać

| Akcja | Co się dzieje |
|---|---|
| Pociągnij królika do tyłu i puść | Celowanie i wystrzał (mysz lub dotyk). Kropkowana linia pokazuje tor lotu |
| Dotknij gwiazdy | Rozbija się, a królik spada |
| Złap 8 z 12 gwiazd | Finał |
| **R** lub przycisk **od nowa** | Nowa runda: nowy układ gwiazd, a królik wpada z powrotem |
| **B** | Pokaż lub ukryj rumieńce |
| **PL / EN** | Zmiana języka |

## Co w niej jest

- **Bardzo bezwładny królik.** Uszy, ręce, nogi i głowa wiszą na sprężynach, w powietrzu się koziołkuje, w locie się rozciąga, a przy lądowaniu spłaszcza. Uderz mocno, a dostanie zawrotów głowy (oczy „x x” i gwiazdki krążące nad głową).
- **W nieznane.** Wyleć poza krawędź ekranu: chwila ciszy, po czym królik spada z góry. Wyląduj poza szklaną kulą, a zniknie w obłoku gwiazdek i znowu wpadnie z góry.
- **Dwanaście gwiazd w rundzie, trzy rodzaje**, wszystkie w kolorach księżyca: puchata gwiazda, błyszcząca kula i gwiazda z samego konturu. Za każdym razem lądują w nowych miejscach, zawsze na torach, które da się trafić prawdziwym strzałem, i przestawiają się same, gdy zmienisz rozmiar okna.
- **Finał.** Złap 8. gwiazdę, a królik zostanie astronautą: hełm pojawi się na nim dokładnie tam, gdzie jest, a on poleci prosto w górę jak rakieta, podczas gdy niebo zmieni się z pastelowego liliowego w głęboki kosmos. Zmaleje w oddali i stanie się migoczącą gwiazdką.
- **Polski i angielski**, do przełączenia w grze.

## Jak powstała

Ten projekt to eksperyment w **reżyserowaniu AI przy tworzeniu gry**, bez napisania ręcznie ani jednej linijki kodu.

- **Koncepcja, kierunek artystyczny, referencje i wszystkie decyzje projektowe:** Agata Poniatowska-Ormicka
- **Projekt:** królik i terrarium zostały zaprojektowane w Midjourney, potem rozcięte w Photoshopie na „części lalki” i makietę kompozycji, żeby proporcje dało się zmierzyć i dokładnie odtworzyć w kodzie
- **Specyfikacja techniczna i review kodu:** Claude (Anthropic)
- **Efekty dźwiękowe:** zrobione w Suno przez Agatę
- **Kod:** Space Bunny, model „stealth” w OpenCode, w około 30 rundach

Praca szła rundami: precyzyjna specyfikacja, budowa, przegląd kodu i zrzutów ekranu, poprawki. Każda runda zmieniała tylko to, o co prosiłam. Recenzent sprawdzał każde twierdzenie w kodzie, co wyłapało zaskakująco wiele błędów, które wykonawca zgłosił jako naprawione.

**Technologia:** [Vite](https://vite.dev/) i [Three.js](https://threejs.org/). Cała geometria jest proceduralna, fasetowana, low-poly z kolorami wierzchołków, a fizyka to prosta, własna symulacja o stałym kroku czasowym (koło na płaszczyźnie 2D z prawdziwymi kolizjami ze szkłem, obręczą, poduszką i cokołem).

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

Otwórz adres, który wypisze Vite. `npm run build` tworzy statyczną stronę w `dist/`.

Podczas pracy dodaj `?tune` do adresu, żeby otworzyć panel na żywo do kolorów, świateł i rozmieszczenia (nie jest częścią wersji produkcyjnej).

## Licencja

**Space Bunny** autorstwa **Agaty Poniatowskiej-Ormickiej** jest udostępniony na licencji [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Możesz go swobodnie udostępniać i adaptować, także komercyjnie, pod warunkiem podania autorstwa. Jeśli coś na nim zbudujesz, oznaczenie lub link wrócą do mnie z radością.

Three.js ma licencję MIT i zachowuje własne warunki.
