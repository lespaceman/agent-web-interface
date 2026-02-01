# Tool Use Example: Add iPhone 17 to Cart on Apple.com

This document walks through a real browser automation session using **athena-browser-mcp** tools. An AI agent navigates apple.com, configures an iPhone 17 (Lavender, 256GB, unlocked), and adds it to the shopping bag — demonstrating navigation, element discovery, progressive form interaction, and state verification across 16 tool calls.

---

## Step 1: Navigate to Apple.com

**Tool:** `navigate`

```json
{
  "url": "https://www.apple.com"
}
```

**Response (trimmed):**

```xml
<state step="1" title="Apple" url="https://www.apple.com/">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <baseline reason="first" />
  <region name="nav">
    <link id="e7bf698a53e2" href="/">Apple</link>
    <link id="c808b33b08c3" href="/us/shop/goto/store">Store</link>
    <btn id="b366be1381dd">Store menu</btn>
    <trimmed count="83" region="nav" hint="Use find_elements with region=nav to see all items" />
    <link id="4082027c9163" href="/apple-events/">Events</link>
    <link id="77eee9570767" href="/contact/">Contact Apple</link>
  </region>
  <region name="main">
    <link id="0acd344b9891" href="/us/shop/goto/store">Shop, Valentine's Day 2026</link>
    <link id="4e3cc7406de6" href="/iphone/">Learn more, iPhone</link>
    <link id="dc756ddfe6cc" href="/us/shop/goto/buy_iphone">Shop iPhone</link>
    <link id="496b2a3014c9" href="/ipad-air/">Learn more, iPad Air</link>
    <link id="18d356f2ee24" href="/us/shop/goto/buy_ipad/ipad_air">Buy, iPad Air</link>
    <trimmed count="17" region="main" hint="Use find_elements with region=main to see all items" />
    <!-- ...promotional gallery items and media links... -->
  </region>
  <region name="footer">
    <link id="14dba07d1512" href="/retail/">Find an Apple Store</link>
    <trimmed count="6" region="footer" hint="Use find_elements with region=footer to see all items" />
    <link id="a9727a323ff9" href="/legal/">Legal</link>
    <link id="c70bb39dc354" href="/sitemap/">Site Map</link>
  </region>
</state>
```

**Response tokens:** 735

**What happened:** The browser launched and loaded the Apple homepage. This is a `baseline reason="first"` — the initial full-page snapshot. Region trimming is active: the nav shows 5 representative elements with a `<trimmed count="83">` tag indicating 83 additional elements available via `find_elements`. The main region shows seasonal promotions and product links.

---

## Step 2: Find iPhone link in nav

**Tool:** `find_elements`

```json
{
  "kind": "link",
  "label": "iPhone",
  "region": "nav",
  "limit": 5
}
```

**Response:**

```xml
<result type="find_elements" page_id="page-2c64c8a8-0cb4-496a-9b1d-54343e2251b2" snapshot_id="snap-1769936250102-1" count="2">
  <match eid="352a00f48ddf" kind="link" label="iPhone" region="nav"
         selector="role=link[name=&quot;iPhone&quot;]" visible="true" enabled="true" href="/iphone/" />
  <match eid="fafb3fd162a9" kind="link" label="iPhone" region="nav"
         selector="role=link[name=&quot;iPhone&quot;]" visible="true" enabled="true" href="/iphone/" />
</result>
```

**Response tokens:** 171

**What happened:** A targeted search found two "iPhone" links in the nav (the main nav bar and a duplicate in the mobile/secondary nav). Both point to `/iphone/`. The first match (`352a00f48ddf`) is in the primary navigation — that's the one to click.

---

## Step 3: Click iPhone link — navigate to iPhone landing page

**Tool:** `click`

```json
{
  "eid": "352a00f48ddf"
}
```

**Response (trimmed):**

```xml
<state step="2" title="iPhone - Apple" url="https://www.apple.com/iphone/">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <baseline reason="navigation" />
  <region name="nav">
    <link id="e7bf698a53e2" href="/">Apple</link>
    <link id="c808b33b08c3" href="/us/shop/goto/store">Store</link>
    <btn id="b366be1381dd">Store menu</btn>
    <trimmed count="117" region="nav" hint="Use find_elements with region=nav to see all items" />
    <link id="4082027c9163" href="/apple-events/">Events</link>
    <link id="77eee9570767" href="/contact/">Contact Apple</link>
  </region>
  <region name="main">
    <link id="0611ad1558c3" href="/us/shop/goto/store">Shop, Valentine's Day gifts at Apple</link>
    <link id="c40c5e58f16e" href="/iphone-17-pro/">iPhone 17 Pro in cosmic orange finish...</link>
    <link id="1d6804dba5bb" href="/iphone-17-pro/">Learn more, iPhone 17 Pro</link>
    <link id="5303aa8d7231" href="/us/shop/goto/buy_iphone/iphone_17_pro">Buy, iPhone 17 Pro</link>
    <trimmed count="41" region="main" hint="Use find_elements with region=main to see all items" />
    <!-- ...other iPhone models, accessories, comparison sections... -->
  </region>
  <region name="header">
    <link id="76e5b70bd102" href="/iphone/compare/">Compare all models</link>
    <link id="47a7d77ecbfa" href="/us/shop/goto/buy_iphone">Shop iPhone</link>
    <link id="adc883f0f3b6" href="/us/shop/goto/iphone/accessories">All iPhone accessories</link>
  </region>
  <region name="footer">
    <link id="3fb4be09bf36" href="https://support.apple.com/121115">support.apple.com/121115</link>
    <trimmed count="17" region="footer" hint="Use find_elements with region=footer to see all items" />
    <link id="a9727a323ff9" href="/legal/">Legal</link>
    <link id="c70bb39dc354" href="/sitemap/">Site Map</link>
  </region>
</state>
```

**Response tokens:** 820

**What happened:** Clicking the iPhone nav link triggered a full navigation (`baseline reason="navigation"`). The iPhone landing page shows the full lineup with hero content for iPhone 17 Pro, iPhone Air, iPhone 17, etc. Region trimming keeps this baseline compact at 820 tokens. The nav expanded to 117 elements (up from 83 on the homepage) with iPhone sub-navigation. A `header` region appeared with comparison and shopping links.

---

## Step 4: Find "Buy" links on iPhone page

**Tool:** `find_elements`

```json
{
  "kind": "link",
  "label": "Buy",
  "region": "main",
  "limit": 10
}
```

**Response:**

```xml
<result type="find_elements" page_id="page-2c64c8a8-0cb4-496a-9b1d-54343e2251b2" snapshot_id="snap-1769936263055-1" count="6">
  <match eid="5303aa8d7231" kind="link" label="Buy, iPhone 17 Pro" region="main"
         visible="true" enabled="true" href="/us/shop/goto/buy_iphone/iphone_17_pro" />
  <match eid="416ef8f3c7c7" kind="link" label="Buy, iPhone Air" region="main"
         visible="true" enabled="true" href="/us/shop/goto/buy_iphone/iphone_air" />
  <match eid="3271d513ca6b" kind="link" label="Buy, iPhone 17" region="main"
         visible="true" enabled="true" href="/us/shop/goto/buy_iphone/iphone_17" />
  <match eid="dfdc75ef73a8" kind="link" label="Buy iPhone 16" region="main"
         visible="true" enabled="true" href="/us/shop/goto/buy_iphone/iphone_16" />
  <match eid="f0370b6a6f02" kind="link" label="Buy iPhone 16e" region="main"
         visible="true" enabled="true" href="/us/shop/goto/buy_iphone/iphone_16e" />
  <match eid="48dd5c6e83cf" kind="link" label="Buy, AirTag" region="main"
         visible="true" enabled="true" href="/us/shop/goto/buy_airtag/airtag" />
</result>
```

**Response tokens:** 499

**What happened:** Found 6 "Buy" links in the main region — one for each iPhone model plus AirTag. The target "Buy, iPhone 17" link has eid `3271d513ca6b`. Note how the label search with `"Buy"` matched partial labels across all models, providing a full inventory of purchase options.

---

## Step 5: Click "Buy, iPhone 17" — navigate to configuration page

**Tool:** `click`

```json
{
  "eid": "3271d513ca6b"
}
```

**Response (trimmed):**

```xml
<state step="3" title="Buy iPhone 17 - Apple" url="https://www.apple.com/shop/buy-iphone/iphone-17">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <baseline reason="navigation" />
  <region name="nav">
    <link id="15107ec4c49d" href="https://www.apple.com/">Apple</link>
    <link id="4031931a5920" href="/store">Store</link>
    <btn id="b366be1381dd">Store menu</btn>
    <trimmed count="85" region="nav" hint="Use find_elements with region=nav to see all items" />
    <link id="f136ecb55d3b" href="https://www.apple.com/apple-events/">Events</link>
    <link id="fc91d77538a5" href="https://www.apple.com/contact/">Contact Apple</link>
  </region>
  <region name="main">
    <btn id="a7665009101c">See all deals </btn>
    <btn id="b65693a4929c">Learn more ⊕</btn>
    <btn id="839b3c5089ca">Get $40–$650 for your trade-in. Footnote # </btn>
    <trimmed count="51" region="main" hint="Use find_elements with region=main to see all items" />
    <!-- ...FAQ buttons, gallery items... -->
  </region>
  <region name="footer">
    <link id="837ba345b070" href="https://www.apple.com/legal/applecare/applecareplus/theftandloss">apple.com/.../theftandloss</link>
    <trimmed count="31" region="footer" hint="Use find_elements with region=footer to see all items" />
    <link id="163b81571f06" href="https://apple.com/legal">Legal</link>
    <link id="c66d34df212c" href="/shop/browse/sitemap">Site Map</link>
  </region>
</state>
```

**Response tokens:** 713

**What happened:** Navigated to the iPhone 17 configuration page on the Apple Store. This is another full baseline with region trimming keeping it compact at 713 tokens. The main region has 51 trimmed elements including all the radio buttons for color, storage, trade-in, payment, carrier, and AppleCare tiers. To see the configuration options, we need `find_elements`.

---

## Step 6: Discover all configuration radio buttons

**Tool:** `find_elements`

```json
{
  "kind": "radio",
  "region": "main",
  "limit": 30
}
```

**Response (trimmed):**

```xml
<result type="find_elements" page_id="page-2c64c8a8-0cb4-496a-9b1d-54343e2251b2" snapshot_id="snap-1769936277909-1" count="20">
  <match eid="995c309fb0e8" kind="radio" label="Lavender" val="lavender" enabled="true" />
  <match eid="b09cee9152b1" kind="radio" label="Sage" val="sage" enabled="true" />
  <match eid="348e5ca1ac7c" kind="radio" label="Mist Blue" val="mistblue" enabled="true" />
  <match eid="9d4f0094c767" kind="radio" label="White" val="white" enabled="true" />
  <match eid="c40e8fe97453" kind="radio" label="Black" val="black" enabled="true" />
  <match eid="87d12aeb2810" kind="radio" label="256GB Footnote 1 From $799..." val="256gb" enabled="false" />
  <match eid="e1f1e837396c" kind="radio" label="512GB Footnote 1 From $999..." val="512gb" enabled="false" />
  <match eid="7025a49d12aa" kind="radio" label="Select a smartphone..." val="tradeIn" enabled="false" />
  <match eid="362e05a22468" kind="radio" label="No trade-in" val="noTradeIn" enabled="false" />
  <match eid="889058cf04ae" kind="radio" label="Buy Pay with Apple Pay..." val="fullprice" enabled="false" />
  <match eid="6fc3cce8c430" kind="radio" label="Finance Pay over time at 0% APR." val="finance" enabled="false" />
  <match eid="ff143192d3be" kind="radio" label="Apple iPhone Upgrade Program..." val="iup" enabled="false" />
  <match eid="bb74eff154bb" kind="radio" label="AT&amp;T..." val="ATT_IPHONE17" enabled="false" />
  <match eid="af10ab05c1a2" kind="radio" label="Boost Mobile..." val="BOOST_IPHONE17" enabled="false" />
  <match eid="c7188009a815" kind="radio" label="T-Mobile..." val="TMOBILE_IPHONE17" enabled="false" />
  <match eid="41f5e82e0091" kind="radio" label="Verizon..." val="VERIZON_IPHONE17" enabled="false" />
  <match eid="6876e357bd73" kind="radio" label="Connect to any carrier later" val="UNLOCKED/US" enabled="false" />
  <match eid="37fa3d7b00ec" kind="radio" label="AppleCare+ with Theft and Loss..." enabled="false" />
  <match eid="aa261273be18" kind="radio" label="New AppleCare One..." enabled="false" />
  <match eid="a5e5a0b7c633" kind="radio" label="No AppleCare coverage" enabled="false" />
</result>
```

**Response tokens:** 1,505

**What happened:** Found all 20 radio buttons across 6 configuration tiers. The `enabled` attribute reveals the progressive disclosure pattern: only the 5 color options are enabled. The remaining 15 options (storage, trade-in, payment, carrier, AppleCare) are disabled until their prerequisite tier is selected. This is how region trimming and `find_elements` work together — the baseline hides detail, and targeted queries reveal it.

---

## Step 7: Select Lavender color

**Tool:** `click`

```json
{
  "eid": "995c309fb0e8"
}
```

**Response:**

```xml
<state step="4" title="Buy iPhone 17 - Apple" url="https://www.apple.com/shop/buy-iphone/iphone-17">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <diff type="mutation" removed="1" />
  <observations>
    <appeared when="action" role="status"></appeared>
  </observations>
  <region name="main">
    <rad id="995c309fb0e8" checked="true" focused="true" val="lavender">Lavender</rad>
    <rad id="87d12aeb2810" val="256gb">256GB Footnote 1 From $799 or $33.29 per month for 24 months Footnote ※</rad>
    <rad id="e1f1e837396c" val="512gb">512GB Footnote 1 From $999 or $41.62 per month for 24 months Footnote ※</rad>
    <btn id="2e21f92e73bd">Show more Not sure how much storage to get?</btn>
  </region>
</state>
```

**Response tokens:** 249

**What happened:** First diff response — only the changed elements are returned. Lavender is now `checked="true"`, and the storage tier (`256GB`, `512GB`) is now enabled (no longer showing `enabled="false"`). The `<diff type="mutation" removed="1" />` tells us 1 element was removed from the DOM. This compact 249-token response is dramatically smaller than a baseline.

---

## Step 8: Select 256GB storage

**Tool:** `click`

```json
{
  "eid": "87d12aeb2810"
}
```

**Response:**

```xml
<state step="5" title="Buy iPhone 17 - Apple" url="https://www.apple.com/shop/buy-iphone/iphone-17">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <diff type="mutation" added="2" removed="5" />
  <observations>
    <disappeared when="action" role="status"></disappeared>
  </observations>
  <region name="main">
    <rad id="87d12aeb2810" checked="true" focused="true" val="256gb">256GB Footnote 1 From $799 or $33.29 per month for 24 months Footnote ※</rad>
    <link id="0d3ba9eafcda" href="https://www.apple.com/iphone-17">iPhone 17</link>
    <rad id="995c309fb0e8" checked="true" val="lavender">Lavender</rad>
    <rad id="7025a49d12aa" val="tradeIn">Select a smartphone Answer a few questions to get your estimate.</rad>
    <rad id="362e05a22468" val="noTradeIn">No trade-in</rad>
    <btn id="01a9f038505e">See all deals Carrier Financing </btn>
    <btn id="dd73a20c983f">Show more How does trade-in work?</btn>
  </region>
</state>
```

**Response tokens:** 330

**What happened:** Another compact diff. 256GB is now `checked="true"`, the trade-in tier is enabled with two options. The diff shows `added="2" removed="5"` — Apple's JavaScript dynamically adds/removes DOM nodes as the form progresses. Both prior selections (Lavender, 256GB) are confirmed checked.

---

## Step 9: Select "No trade-in"

**Tool:** `click`

```json
{
  "eid": "362e05a22468"
}
```

**Response:**

```xml
<state step="6" title="Buy iPhone 17 - Apple" url="https://www.apple.com/shop/buy-iphone/iphone-17">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <diff type="mutation" added="3" removed="3" />
  <region name="main">
    <rad id="362e05a22468" checked="true" focused="true" val="noTradeIn">No trade-in</rad>
    <rad id="87d12aeb2810" checked="true" val="256gb">256GB Footnote 1 From $799 or $33.29 per month for 24 months Footnote ※</rad>
    <rad id="067a237c5e5a" val="fullprice">Buy From $799.00 Footnote ‡ Pay with Apple Pay or other payment methods.</rad>
    <rad id="b036e3106556" val="finance">Finance $33.29 per month for 24 months Footnote ※ ...</rad>
    <rad id="338ce3b85f4b" val="iup">Apple iPhone Upgrade Program $42.41 per month for 24 months Footnote ※ ...</rad>
    <btn id="6d6cb6e07c65">Show more Not sure which payment option to choose?</btn>
  </region>
</state>
```

**Response tokens:** 350

**What happened:** No trade-in selected. The payment tier is now enabled with three options: Buy (full price), Finance (0% APR), and iPhone Upgrade Program. Note that the `val` attributes on payment radio buttons differ from the initial `find_elements` results — the form dynamically generates new element instances as the configuration progresses.

---

## Step 10: Select "Buy" (full price)

**Tool:** `click`

```json
{
  "eid": "067a237c5e5a"
}
```

**Response:**

```xml
<state step="7" title="Buy iPhone 17 - Apple" url="https://www.apple.com/shop/buy-iphone/iphone-17">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <diff type="mutation" added="5" removed="5" />
  <region name="main">
    <rad id="067a237c5e5a" checked="true" focused="true" val="fullprice">Buy From $799.00 Footnote ‡ Pay with Apple Pay or other payment methods.</rad>
    <rad id="362e05a22468" checked="true" val="noTradeIn">No trade-in</rad>
    <rad id="21c5cfdb512b" val="ATT_IPHONE17">AT&amp;T $799.00 Footnote ‡ Includes $30 connectivity discount (requires carrier activation)</rad>
    <rad id="834b48326f2a" val="BO•••NE">Boost Mobile $799.00 Footnote ‡ ...</rad>
    <rad id="910e767e3e3d" val="TM•••HO">T-Mobile $799.00 Footnote ‡ ...</rad>
    <rad id="377b883fea4d" val="VE•••HO">Verizon $799.00 Footnote ‡ ...</rad>
    <rad id="bce6fc042f7b" val="UNLOCKED/US">Connect to any carrier later $829.00</rad>
    <btn id="6fbaa181e7ab">Show more Is it easy to get connected?</btn>
  </region>
</state>
```

**Response tokens:** 395

**What happened:** Full price selected. The carrier tier now shows 5 options: AT&T, Boost Mobile, T-Mobile, Verizon (each at $799 with a connectivity discount), and unlocked at $829. The carrier eids are different from the initial `find_elements` (`21c5cfdb512b` vs `bb74eff154bb`) — the form regenerated these elements with updated pricing context.

---

## Step 11: Select "Connect to any carrier later" (unlocked)

**Tool:** `click`

```json
{
  "eid": "bce6fc042f7b"
}
```

**Response (trimmed):**

```xml
<state step="8" title="Buy iPhone 17 256GB Lavender - Apple"
       url="https://www.apple.com/shop/buy-iphone/iphone-17/6.3-inch-display-256gb-lavender-unlocked">
  <meta view="1521x751" scroll="0,0" layer="main" />
  <baseline reason="navigation" />
  <observations>
    <appeared when="action">Previous Unavailable for 2-hr delivery In Stock Pick up from Store Next</appeared>
  </observations>
  <region name="main">
    <rad id="bce6fc042f7b" checked="true" focused="true" val="UNLOCKED/US">Connect to any carrier later $829.00</rad>
    <rad id="995c309fb0e8" checked="true" val="lavender">Lavender</rad>
    <rad id="87d12aeb2810" checked="true" val="256gb">256GB...</rad>
    <rad id="362e05a22468" checked="true" val="noTradeIn">No trade-in</rad>
    <rad id="067a237c5e5a" checked="true" val="fullprice">Buy From $799.00...</rad>
    <!-- ...all prior selections confirmed checked... -->
    <rad id="f34e2db77810">AppleCare+ with Theft and Loss... $11.99/mo or $119.99/yr</rad>
    <rad id="d5adde59b920">New AppleCare One... $19.99/mo</rad>
    <rad id="a5e5a0b7c633">No AppleCare coverage</rad>
    <btn id="3ad02544bf11">Get delivery dates </btn>
    <btn id="769c5485faa5">Check availability iPhone 17 256GB Lavender </btn>
    <!-- ...FAQ buttons, compare links... -->
  </region>
  <region name="nav">
    <link id="15107ec4c49d" href="https://www.apple.com/">Apple</link>
    <link id="478e4edc6d2d" href="https://www.apple.com/iphone/">iPhone</link>
    <!-- ...full Apple Store nav with 85+ links: breadcrumbs, mega-menu, account, services... -->
    <link id="fc91d77538a5" href="https://www.apple.com/contact/">Contact Apple</link>
  </region>
  <region name="footer">
    <!-- ...AppleCare legal footnotes, Goldman Sachs terms, carrier disclosures... -->
    <link id="163b81571f06" href="https://apple.com/legal">Legal</link>
    <link id="c66d34df212c" href="/shop/browse/sitemap">Site Map</link>
  </region>
  <region name="form">
    <btn id="31f426071430" enabled="false" val="add-to-cart">Add to Bag</btn>
  </region>
</state>
```

**Response tokens:** 6,375

**What happened:** Selecting the unlocked carrier triggered a URL change — the URL now includes the full configuration slug: `6.3-inch-display-256gb-lavender-unlocked`. This caused a full `baseline reason="navigation"` snapshot without region trimming, ballooning from 713 to 6,375 tokens. The AppleCare tier is now visible with pricing. The "Add to Bag" button appears in a `<region name="form">` with `enabled="false"` — it requires an AppleCare selection first.

---

## Step 12: Select "No AppleCare coverage"

**Tool:** `click`

```json
{
  "eid": "a5e5a0b7c633"
}
```

**Response:**

```xml
<state step="9" title="Buy iPhone 17 256GB Lavender - Apple"
       url="https://www.apple.com/shop/buy-iphone/iphone-17/6.3-inch-display-256gb-lavender-unlocked">
  <meta view="1521x751" scroll="0,0" layer="main" />
  <diff type="mutation" removed="1" />
  <observations>
    <disappeared when="action" role="status"></disappeared>
  </observations>
  <region name="main">
    <rad id="a5e5a0b7c633" checked="true" focused="true">No AppleCare coverage</rad>
    <rad id="bce6fc042f7b" checked="true" val="UNLOCKED/US">Connect to any carrier later $829.00</rad>
    <btn id="8a463fcdc005">Get 3% Daily Cash with Apple Card </btn>
    <btn id="0212508631ac">Save for later</btn>
  </region>
  <region name="form">
    <btn id="31f426071430" val="add-to-cart">Add to Bag</btn>
  </region>
</state>
```

**Response tokens:** 276

**What happened:** All 6 configuration tiers complete. The "Add to Bag" button is now enabled (no longer showing `enabled="false"`). The diff is extremely compact — just the changed radio state and newly enabled form button. Configuration summary: iPhone 17, Lavender, 256GB, no trade-in, full price ($829), unlocked, no AppleCare.

---

## Step 13: Click "Add to Bag"

**Tool:** `click`

```json
{
  "eid": "31f426071430"
}
```

**Response (trimmed):**

```xml
<state step="10" title="Buy iPhone 17 - Apple" url="https://www.apple.com/shop/buy-iphone/iphone-17">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <baseline reason="navigation" />
  <region name="nav">
    <link id="15107ec4c49d" href="https://www.apple.com/">Apple</link>
    <link id="478e4edc6d2d" href="https://www.apple.com/iphone/">iPhone</link>
    <!-- ...full Apple Store nav... -->
    <btn id="a193d322205b">Shopping Bag with item count : 3</btn>
    <!-- ...breadcrumbs, mega-menu links... -->
  </region>
  <region name="form">
    <btn id="71950a065996" val="proceed">Review Bag</btn>
  </region>
  <region name="main">
    <elt id="8f2319753aaa" selected="true">Style. In a snap. - 1</elt>
    <rad id="887ea76c598a" checked="true" val="purplefog">Purple Fog iPhone 17 Silicone Case with MagSafe</rad>
    <btn id="54ddf1239984">Add to Bag iPhone 17 Silicone Case with MagSafe - Purple Fog $49.00...</btn>
    <rad id="6ae29a42c60b" checked="true" val="purple">Purple Crossbody Strap</rad>
    <btn id="4b2e1240fb19">Add to Bag Crossbody Strap - Purple $59.00...</btn>
    <rad id="50708ea27407" checked="true" val="clear">Clear iPhone 17 Clear Case with MagSafe</rad>
    <btn id="d8f435ed7c01">Add to Bag iPhone 17 Clear Case with MagSafe $49.00...</btn>
    <!-- ...power adapter, AirPods, AirTag upsell carousels... -->
  </region>
  <region name="footer">
    <!-- ...footnotes... -->
    <link id="163b81571f06" href="https://apple.com/legal">Legal</link>
    <link id="c66d34df212c" href="/shop/browse/sitemap">Site Map</link>
  </region>
</state>
```

**Response tokens:** 6,060

**What happened:** The iPhone was added to the bag. Apple redirected to an accessories upsell page showing color-matched accessories: Purple Fog Silicone Case ($49), Purple Crossbody Strap ($59), Clear Case ($49), plus power adapters, AirPods, and AirTags in carousels. The nav shows "Shopping Bag with item count : 3". A "Review Bag" button (`val="proceed"`) appears in the form region.

---

## Step 14: Click "Review Bag"

**Tool:** `click`

```json
{
  "eid": "71950a065996"
}
```

**Response (trimmed):**

```xml
<state step="11" title="Bag - Apple" url="https://www.apple.com/shop/bag">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <baseline reason="navigation" />
  <region name="nav">
    <link id="15107ec4c49d" href="https://www.apple.com/">Apple</link>
    <!-- ...full Apple Store nav... -->
    <btn id="5ed8a7875d78">Shopping Bag with item count : 4</btn>
    <!-- ...mega-menu, account, services links... -->
  </region>
  <region name="main">
    <btn id="626b215b3074">Check out with Pay</btn>
    <btn id="e3214e723f77">Check Out</btn>
    <link id="8f045d76a8af" href="/shop/product/mg494ll/a/6.3-inch-display-256gb-lavender?cppart=UNLOCKED/US">iPhone 17 256GB Lavender</link>
    <elt id="da7c86f781dc" val="••••" type="tel">Quantity:</elt>
    <btn id="f12437c38d81">Remove iPhone 17 256GB Lavender</btn>
    <link id="c2587aa93406" href="/shop/product/mg464ll/a/6.3-inch-display-256gb-black?cppart=UNLOCKED/US">iPhone 17 256GB Black</link>
    <sel id="b62b66e9d5c9">Quantity for iPhone 17 256GB Black</sel>
    <btn id="4703e777f0b6">Remove iPhone 17 256GB Black</btn>
    <!-- ...accessory suggestions, duplicate checkout buttons... -->
    <btn id="e3214e723f77-2">Check Out</btn>
  </region>
  <region name="footer">
    <link id="f5cddba32ab5" href="https://www.apple.com/retail">Find an Apple Store</link>
    <!-- ...standard footer... -->
    <link id="c66d34df212c" href="/shop/browse/sitemap">Site Map</link>
  </region>
</state>
```

**Response tokens:** 4,168

**What happened:** The Shopping Bag page shows the newly added "iPhone 17 256GB Lavender" (unlocked) along with a previously-in-cart "iPhone 17 256GB Black". Each has quantity controls and remove buttons. The "Check Out" button is prominently displayed. The nav confirms "Shopping Bag with item count : 4". Mission accomplished — the iPhone is in the cart.

---

## Step 15: Verify page stability

**Tool:** `capture_snapshot`

```json
{}
```

**Response:**

```xml
<state step="12" title="Bag - Apple" url="https://www.apple.com/shop/bag">
  <meta view="1521x752" scroll="0,0" layer="main" />
  <diff type="mutation" />
</state>
```

**Response tokens:** 59

**What happened:** An empty diff — no mutations since the last snapshot. The page is fully stable and settled. This is the most compact possible response: just the state metadata confirming nothing changed.

---

## Step 16: Close browser session

**Tool:** `close_session`

```json
{}
```

**Response:**

```xml
<result type="close_session" status="success">
  <closed />
</result>
```

**Response tokens:** 20

**What happened:** Browser session closed cleanly. All browser processes terminated. The complete flow — from homepage to configured iPhone in cart — is done.

---

## Summary

| Step | Tool               | Action                     | Result                                  | Response Tokens |
| ---- | ------------------ | -------------------------- | --------------------------------------- | --------------- |
| 1    | `navigate`         | Load apple.com             | Homepage baseline (trimmed)             | 735             |
| 2    | `find_elements`    | Find "iPhone" links in nav | 2 matches found                         | 171             |
| 3    | `click`            | Click iPhone nav link      | iPhone landing page baseline (trimmed)  | 820             |
| 4    | `find_elements`    | Find "Buy" links in main   | 6 matches found                         | 499             |
| 5    | `click`            | Click "Buy, iPhone 17"     | Configuration page baseline (trimmed)   | 713             |
| 6    | `find_elements`    | Discover all radio buttons | 20 radios across 6 tiers                | 1,505           |
| 7    | `click`            | Select Lavender            | Diff: color set, storage enabled        | 249             |
| 8    | `click`            | Select 256GB               | Diff: storage set, trade-in enabled     | 330             |
| 9    | `click`            | Select No trade-in         | Diff: payment tier enabled              | 350             |
| 10   | `click`            | Select Buy (full price)    | Diff: carrier tier enabled              | 395             |
| 11   | `click`            | Select Unlocked            | Full config URL baseline (untrimmed)    | 6,375           |
| 12   | `click`            | Select No AppleCare        | Diff: Add to Bag enabled                | 276             |
| 13   | `click`            | Add to Bag                 | Accessories upsell baseline (untrimmed) | 6,060           |
| 14   | `click`            | Review Bag                 | Shopping Bag baseline (untrimmed)       | 4,168           |
| 15   | `capture_snapshot` | Verify stability           | Empty diff (no changes)                 | 59              |
| 16   | `close_session`    | Close browser              | Session closed                          | 20              |
|      |                    |                            | **Total**                               | **22,725**      |

### Token Costs

_Token analysis methodology: Counts generated using `@xenova/transformers` with `Xenova/claude-tokenizer` for accurate Claude-model token estimation. Total input (tool parameters) across all 16 calls: 171 tokens. Response tokens dominate at a 133:1 ratio._

#### Region-wise breakdown of baseline snapshots

6 of the 16 tool calls returned full baseline snapshots. These are the costliest responses — but 3 of the 6 benefited from region trimming.

**Step 1: `navigate` — apple.com homepage (735 tokens) — trimmed**

| Region                | Tokens | % of Total |
| --------------------- | ------ | ---------- |
| main                  | 385    | 52.4%      |
| footer                | 148    | 20.1%      |
| nav                   | 146    | 19.9%      |
| \_header (state/meta) | 50     | 6.8%       |

**Step 3: `click` — iPhone landing page (820 tokens) — trimmed**

| Region                | Tokens | % of Total |
| --------------------- | ------ | ---------- |
| main                  | 351    | 42.8%      |
| footer                | 163    | 19.9%      |
| nav                   | 146    | 17.8%      |
| header                | 99     | 12.1%      |
| \_header (state/meta) | 54     | 6.6%       |

**Step 5: `click` — Buy iPhone 17 config page (713 tokens) — trimmed**

| Region                | Tokens | % of Total |
| --------------------- | ------ | ---------- |
| main                  | 302    | 42.4%      |
| footer                | 178    | 25.0%      |
| nav                   | 163    | 22.9%      |
| \_header (state/meta) | 64     | 9.0%       |

**Step 11: `click` — Unlocked carrier / full config URL (6,375 tokens) — untrimmed**

| Region                | Tokens | % of Total |
| --------------------- | ------ | ---------- |
| nav                   | 2,732  | 42.9%      |
| main                  | 1,866  | 29.3%      |
| footer                | 1,612  | 25.3%      |
| \_header (state/meta) | 85     | 1.3%       |
| form                  | 40     | 0.6%       |
| \_observations        | 32     | 0.5%       |

**Step 13: `click` — Add to Bag / accessories upsell (6,060 tokens) — untrimmed**

| Region                | Tokens | % of Total |
| --------------------- | ------ | ---------- |
| nav                   | 2,871  | 47.4%      |
| main                  | 2,375  | 39.2%      |
| footer                | 712    | 11.7%      |
| \_header (state/meta) | 64     | 1.1%       |
| form                  | 31     | 0.5%       |

**Step 14: `click` — Shopping Bag (4,168 tokens) — untrimmed**

| Region                | Tokens | % of Total |
| --------------------- | ------ | ---------- |
| nav                   | 2,673  | 64.1%      |
| main                  | 1,172  | 28.1%      |
| footer                | 261    | 6.3%       |
| \_header (state/meta) | 56     | 1.3%       |

**Key finding — trimmed vs untrimmed:** Region trimming reduced early baselines to 713–820 tokens (nav ~146–163 tokens). Without trimming, the Apple Store nav alone costs 2,673–2,871 tokens. On the Bag page, untrimmed nav accounts for 64% of the entire response.

#### Repeated element IDs across baselines

Across 6 baselines: **349 unique eids**, of which **115 appear in 2+ baselines**.

| Steps Present   | Shared EIDs | Description                                         |
| --------------- | ----------- | --------------------------------------------------- |
| 11, 13, 14      | 86          | Apple Store pages share the full store nav          |
| 5, 11           | 11          | Config page before/after carrier selection          |
| 5, 11, 13, 14   | 6           | Global nav elements (Apple, Store, Legal, Site Map) |
| 1, 3            | 6           | Apple.com → iPhone page shared nav links            |
| 11, 13          | 5           | Store nav elements unique to pre-bag pages          |
| All 6 baselines | 1           | `b366be1381dd` ("Store menu" button)                |

**What are these shared elements?** Almost exclusively nav/footer links — Store, Mac, iPad, iPhone, Watch, Accessories, Support, account links, service links, etc. These are the global Apple Store navigation that appears identically on every page.

| EID            | Element                               |
| -------------- | ------------------------------------- |
| `053e142b39f8` | `<link>Accessories</link>`            |
| `061efb6d0889` | `<link>Health on Apple Watch</link>`  |
| `0a96c4541fec` | `<link>Apple Books</link>`            |
| `0d33f0c32f88` | `<btn>Search apple.com</btn>`         |
| `140007205b9a` | `<btn>TV and Home menu</btn>`         |
| `16dfe280014d` | `<link>Find a Store</link>`           |
| `1a0e6c6be854` | `<link>Carrier Deals at Apple</link>` |
| `1bc2db033802` | `<link>Sales and Refunds</link>`      |

**Token cost of repeated elements per baseline:**

| Step | Page                     | Repeated EID Tokens | Total Tokens | % Repeated |
| ---- | ------------------------ | ------------------- | ------------ | ---------- |
| 1    | Homepage (trimmed)       | 150                 | 735          | 20.4%      |
| 3    | iPhone landing (trimmed) | 150                 | 820          | 18.3%      |
| 5    | Config page (trimmed)    | 500                 | 713          | 70.1%      |
| 11   | Config page (untrimmed)  | 3,296               | 6,375        | 51.7%      |
| 13   | Accessories upsell       | 2,973               | 6,060        | 49.1%      |
| 14   | Shopping Bag             | 2,814               | 4,168        | 67.5%      |

Steps 11 and 14 (untrimmed baselines on the same site) carry 52–68% repeated content — the same Apple Store nav rendered again on each page. Region trimming partially addresses this for steps 1, 3, and 5 by collapsing repeated nav elements behind `<trimmed>` tags.

### Key Observations

1. **Progressive disclosure**: The iPhone configuration page uses 6 sequential tiers. Each tier unlocks only after the previous selection, preventing invalid configurations. The `enabled="false"` attribute makes this visible in the snapshot.

2. **Diff-based responses save ~95% of tokens**: Steps 7–10 and 12 produced compact diffs averaging ~320 tokens each, versus untrimmed baselines averaging ~5,534 tokens. The diff system reduces per-step cost by ~94% for in-page mutations.

3. **Region trimming cuts baselines by ~88%**: Steps 1, 3, and 5 used region trimming, averaging 756 tokens per baseline. Steps 11, 13, and 14 were untrimmed, averaging 5,534 tokens — a 7.3x difference. The 3 trimmed baselines collectively used 2,268 tokens vs 16,603 for 3 untrimmed baselines.

4. **Stable element IDs**: Key elements maintained consistent eids across snapshots. The Lavender radio (`995c309fb0e8`), 256GB radio (`87d12aeb2810`), and No AppleCare radio (`a5e5a0b7c633`) kept the same eid throughout the flow, enabling reliable re-targeting.

5. **Navigation vs mutation cost**: 6 baseline steps (37.5% of calls) consumed 18,871 tokens (83.0% of total). 5 diff steps consumed 1,600 tokens (7.0%). The remaining 5 steps (find_elements, capture, close) used 2,254 tokens (9.9%).

6. **Nav region dominates untrimmed baselines (43–64%)**: The Apple Store nav (85+ links) consumes 2,673–2,871 tokens per untrimmed baseline. On the Bag page, nav alone is 64.1% of the response. Region trimming collapses this to ~146 tokens (a 95% reduction).

7. **`find_elements` + trimming work together**: The trimmed config page baseline (Step 5, 713 tokens) hid all 20 radio buttons behind `<trimmed count="51">`. The subsequent `find_elements` (Step 6, 1,505 tokens) revealed them on demand. Total: 2,218 tokens vs the 6,375 tokens of the untrimmed equivalent (Step 11) — a 65% saving while providing the same information.

8. **Total session cost: 22,725 response tokens** for a 16-step flow across 6 page navigations. The entire session input (tool parameters) totaled only 171 tokens — responses dominate the token budget at a 133:1 ratio.
