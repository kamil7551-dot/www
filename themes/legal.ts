import { html } from "hono/html";
import type { SiteSettings, Tenant } from "../core";
import { zl } from "./shared";

/**
 * Legal page templates filled in from the site settings. They are a starting point written
 * for small Polish sellers (consumer law of 30 May 2014, GDPR), not legal advice: the panel
 * tells sellers to check them. Change wording only together with a dated note in ROADMAP.md.
 */

interface Legal {
  tenant: Tenant;
  settings: SiteSettings;
  origin: string;
}

const seller = ({ tenant, settings: s }: Legal) => html`<p>
  <strong>${s.companyName || tenant.name}</strong>${s.address ? html`, ${s.address}` : ""}${s.nip ? html`, NIP ${s.nip}` : ""}<br />
  ${s.email ? html`e-mail: <a href="mailto:${s.email}">${s.email}</a>` : ""}${s.email && s.phone ? ", " : ""}${s.phone ? html`tel. ${s.phone}` : ""}
</p>`;

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => html`<p class="pre">${p}</p>`);

export const legalLinks = (kind: Tenant["kind"]) => html`<nav class="legal-links" aria-label="Informacje prawne">
  ${kind === "shop" ? html`<a href="/regulamin">Regulamin</a> <a href="/odstapienie">Zwroty</a> ` : ""}<a href="/polityka-prywatnosci">Polityka prywatności</a>
</nav>`;

export function termsPage(v: Legal) {
  const s = v.settings;
  const delivery = [s.pickup ? "odbiór osobisty (bez opłat)" : "", s.courierPrice !== null ? `przesyłka kurierska (${zl(s.courierPrice)})` : ""].filter(Boolean);
  const payment = [s.pickup ? "płatność przy odbiorze osobistym" : "", s.courierPrice !== null && s.bankAccount ? "przelew na rachunek bankowy sprzedawcy" : ""].filter(Boolean);
  return html`<article class="legal">
    <h1>Regulamin sklepu</h1>
    <h2>1. Sprzedawca</h2>
    <p>Sklep internetowy dostępny pod adresem ${v.origin} prowadzi:</p>
    ${seller(v)}
    <h2>2. Zamówienia</h2>
    <p>Zamówienie składa się bez zakładania konta: wybierasz produkty, podajesz dane do realizacji, wybierasz sposób dostawy i potwierdzasz zamówienie przyciskiem „Zamawiam i płacę”. Umowa sprzedaży zostaje zawarta, gdy wyślemy na Twój e-mail potwierdzenie przyjęcia zamówienia.</p>
    <p>Ceny są cenami brutto w złotych polskich. Koszt dostawy jest podany przed złożeniem zamówienia.</p>
    <h2>3. Dostawa i płatność</h2>
    <p>Dostępne sposoby dostawy: ${delivery.join(", ") || "ustalane indywidualnie"}.${s.address && s.pickup ? html` Odbiór osobisty: ${s.address}${s.hours ? `, ${s.hours}` : ""}.` : ""}</p>
    <p>Dostępne sposoby płatności: ${payment.join(", ") || "ustalane indywidualnie"}. Przy przelewie wysyłamy zamówienie po zaksięgowaniu wpłaty.</p>
    <h2>4. Odstąpienie od umowy (zwrot)</h2>
    <p>Jeśli kupujesz jako konsument, możesz odstąpić od umowy bez podania przyczyny w ciągu 14 dni od dnia, w którym otrzymałeś towar. Wystarczy, że przed upływem tego terminu wyślesz nam oświadczenie, na przykład e-mailem albo przez <a href="/odstapienie">wzór formularza odstąpienia</a>.</p>
    <p>Zwrócimy wszystkie otrzymane płatności, w tym najtańszy oferowany koszt dostawy, nie później niż 14 dni od otrzymania Twojego oświadczenia, tym samym sposobem płatności, chyba że uzgodnimy inaczej. Możemy wstrzymać zwrot do chwili otrzymania towaru albo dowodu jego odesłania. Towar odeślij nie później niż 14 dni od odstąpienia od umowy; bezpośredni koszt odesłania ponosisz Ty.</p>
    <p>Prawo odstąpienia nie przysługuje m.in. przy towarach wyprodukowanych na Twoje indywidualne zamówienie, szybko psujących się oraz przy towarach w zapieczętowanym opakowaniu, które po otwarciu nie nadają się do zwrotu ze względów higienicznych, jeśli opakowanie zostało otwarte.</p>
    <p>Te same prawa ma osoba prowadząca jednoosobową działalność gospodarczą, jeśli zakup nie ma dla niej charakteru zawodowego.</p>
    <h2>5. Reklamacje</h2>
    <p>Odpowiadamy za zgodność towaru z umową na zasadach ustawy o prawach konsumenta. Jeśli towar jest niezgodny z umową, możesz żądać jego naprawy albo wymiany, a w przypadkach wskazanych w ustawie obniżenia ceny lub odstąpienia od umowy.</p>
    <p>Reklamację wyślij na dane sprzedawcy podane wyżej, najlepiej z opisem problemu i numerem zamówienia. Odpowiemy w ciągu 14 dni.</p>
    <h2>6. Spory</h2>
    <p>Jeśli nie dojdziemy do porozumienia, możesz skorzystać z bezpłatnej pomocy miejskiego lub powiatowego rzecznika konsumentów albo zwrócić się do wojewódzkiego inspektoratu Inspekcji Handlowej. Informacje znajdziesz na stronie UOKiK.</p>
    <h2>7. Dane osobowe</h2>
    <p>Zasady przetwarzania danych opisuje <a href="/polityka-prywatnosci">polityka prywatności</a>.</p>
    ${s.extraTerms ? html`<h2>8. Postanowienia dodatkowe</h2>${paragraphs(s.extraTerms)}` : ""}
  </article>`;
}

export function privacyPage(v: Legal) {
  const shop = v.tenant.kind === "shop";
  return html`<article class="legal">
    <h1>Polityka prywatności</h1>
    <h2>Kto przetwarza Twoje dane</h2>
    <p>Administratorem Twoich danych osobowych jest:</p>
    ${seller(v)}
    <h2>Jakie dane i po co</h2>
    <ul>
      ${shop
        ? html`<li>Dane z zamówienia (imię i nazwisko, e-mail, telefon, adres dostawy): żeby zrealizować zamówienie i umowę (art. 6 ust. 1 lit. b RODO) oraz rozliczyć sprzedaż zgodnie z przepisami podatkowymi (art. 6 ust. 1 lit. c RODO).</li>`
        : ""}
      <li>Dane z formularza kontaktowego (imię, e-mail, opcjonalnie telefon, treść wiadomości): żeby odpowiedzieć na Twoją wiadomość, co jest naszym prawnie uzasadnionym interesem (art. 6 ust. 1 lit. f RODO).</li>
    </ul>
    <p>Podanie danych jest dobrowolne, ale bez nich nie zrealizujemy zamówienia ani nie odpowiemy na wiadomość.</p>
    <h2>Komu je przekazujemy</h2>
    <p>Dane mogą trafić do firm, które pomagają nam prowadzić stronę i realizować zamówienia: dostawcy platformy i serwerów, dostawcy poczty e-mail${shop ? ", firmie kurierskiej i biuru rachunkowemu" : ""}. Robią to wyłącznie na nasze polecenie.</p>
    <h2>Jak długo</h2>
    <p>${shop
        ? "Dane z zamówień przechowujemy przez czas potrzebny do realizacji umowy i rozpatrzenia reklamacji, a potem tak długo, jak wymagają tego przepisy podatkowe (zwykle 5 lat od końca roku). "
        : ""}Wiadomości z formularza przechowujemy do czasu zakończenia rozmowy, a potem nie dłużej niż rok.</p>
    <h2>Twoje prawa</h2>
    <p>Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przeniesienia oraz prawo sprzeciwu. Napisz do nas na dane podane wyżej. Masz też prawo złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych.</p>
    <h2>Ciasteczka</h2>
    <p>Strona nie używa ciasteczek reklamowych ani analitycznych.${shop ? " Używa jednego ciasteczka niezbędnego do działania koszyka; zawiera ono tylko listę wybranych produktów." : ""}</p>
  </article>`;
}

export function withdrawalPage(v: Legal) {
  return html`<article class="legal">
    <h1>Zwroty: formularz odstąpienia od umowy</h1>
    <p>Masz 14 dni od otrzymania towaru, żeby odstąpić od umowy bez podania przyczyny. Najprościej napisać do nas e-mail z numerem zamówienia. Możesz też wydrukować i wypełnić ten formularz. Szczegóły są w <a href="/regulamin">regulaminie</a>.</p>
    <div class="form-print">
      <p><strong>Adresat:</strong></p>
      ${seller(v)}
      <p>Ja/My(*) niniejszym informuję/informujemy(*) o moim/naszym odstąpieniu od umowy sprzedaży następujących rzeczy(*):</p>
      <p class="blank">…………………………………………………………………………</p>
      <p>Numer zamówienia: ……………… Data zawarcia umowy(*) / odbioru(*): ………………</p>
      <p>Imię i nazwisko konsumenta(-ów): ……………………………………………</p>
      <p>Adres konsumenta(-ów): ……………………………………………………………</p>
      <p>Numer konta do zwrotu pieniędzy (jeśli inny niż do płatności): ……………………………</p>
      <p>Podpis konsumenta(-ów) (tylko jeżeli formularz jest przesyłany w wersji papierowej): ………………</p>
      <p>Data: ………………</p>
      <p class="muted">(*) Niepotrzebne skreślić.</p>
    </div>
  </article>`;
}
