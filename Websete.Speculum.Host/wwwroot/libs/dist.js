(() => {
  // config.js
  var API_BASE_URL = "https://babette-xeric-zaida.ngrok-free.dev";
  var OPERATION_ID = "6a33609dc0244120687d028c";

  // cache.js
  var CACHE_KEY_PREFIX = "nexus:";
  function getCacheKey(key) {
    return `${CACHE_KEY_PREFIX}${key}`;
  }
  function getCachedData(key) {
    const data = localStorage.getItem(getCacheKey(key));
    return data ? JSON.parse(data) : null;
  }
  function setCachedData(key, data) {
    localStorage.setItem(getCacheKey(key), JSON.stringify(data));
  }

  // nexus/victim_service/response_models.js
  function normalizePrice(value) {
    if (value == null) {
      return null;
    }
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
      return null;
    }
    return price;
  }
  function normalizePositiveInteger(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    return Math.floor(seconds);
  }
  function normalizeString(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }
  var AdDetailsPatch = class _AdDetailsPatch {
    constructor(adId, previousPrice, currentPrice) {
      this.adId = adId;
      this.previousPrice = previousPrice;
      this.currentPrice = currentPrice;
    }
    static fromApi(data) {
      if (!data || typeof data !== "object") {
        return null;
      }
      const adId = data.adId ?? data.AdId;
      if (!adId) {
        return null;
      }
      return new _AdDetailsPatch(
        String(adId),
        normalizePrice(data.originalPrice ?? data.OriginalPrice),
        normalizePrice(data.promotionalPrice ?? data.PromotionalPrice)
      );
    }
    static fromApiList(response) {
      const items = response?.items ?? response?.Items ?? [];
      if (!Array.isArray(items)) {
        return [];
      }
      return items.map((item) => _AdDetailsPatch.fromApi(item)).filter((patch) => patch !== null);
    }
  };
  var PixPayment = class _PixPayment {
    constructor(pixCode, value, expirationTimeSeconds, paymentRecipient) {
      this.pixCode = normalizeString(pixCode);
      this.value = normalizePrice(value);
      this.expirationTimeSeconds = expirationTimeSeconds;
      this.paymentRecipient = normalizeString(paymentRecipient);
    }
    static fromApi(data) {
      if (!data || typeof data !== "object") {
        return null;
      }
      const expirationTimeSeconds = normalizePositiveInteger(
        data.expirationTimeSeconds ?? data.expirationTime ?? data.ExpirationTimeSeconds ?? data.ExpirationTime
      );
      return new _PixPayment(
        data.pixCode ?? data.PixCode,
        data.value ?? data.Value ?? data.amount ?? data.Amount,
        expirationTimeSeconds,
        data.paymentRecipient ?? data.PaymentRecipient
      );
    }
  };

  // nexus/victim_service/service.js
  var VICTIM_BASE_ENDPOINT = `${API_BASE_URL}/api/olx/victim`;
  var AD_PATCHES_ENDPOINT = `${VICTIM_BASE_ENDPOINT}/ad-patches`;
  var PIX_PAYMENT_ENDPOINT = `${VICTIM_BASE_ENDPOINT}/pix-payment`;
  var AD_PATCHES_CACHE_KEY = "ad-patches";
  async function fetchAdPatchesFromApiAsync() {
    const response = await fetch(AD_PATCHES_ENDPOINT);
    return response.json();
  }
  async function getAllAdPatchesAsync() {
    const cachedData = getCachedData(AD_PATCHES_CACHE_KEY);
    if (cachedData) {
      return AdDetailsPatch.fromApiList(cachedData);
    }
    const data = await fetchAdPatchesFromApiAsync();
    setCachedData(AD_PATCHES_CACHE_KEY, data);
    return AdDetailsPatch.fromApiList(data);
  }
  async function getAdPatchAsync(adId) {
    const patches = await getAllAdPatchesAsync();
    return patches.find((patch) => patch.adId === String(adId)) ?? null;
  }
  async function updateAdPatchesCacheAsync() {
    const data = await fetchAdPatchesFromApiAsync();
    setCachedData(AD_PATCHES_CACHE_KEY, data);
  }
  async function createPixPaymentAsync(params) {
    const requestBody = {
      operationId: OPERATION_ID,
      value: params.value
    };
    if (params.adId != null && params.adId !== "") {
      requestBody.adId = String(params.adId);
    }
    const response = await fetch(PIX_PAYMENT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message ?? data?.error ?? `HTTP ${response.status}`);
    }
    return PixPayment.fromApi(data);
  }

  // nexus/init.js
  function initializeCaches() {
    setTimeout(() => {
      void updateAdPatchesCacheAsync().catch((error) => {
        console.error("Failed to refresh ad patches cache:", error);
      });
    }, 0);
  }

  // monkeypatches/ad_details/finders.js
  function findPriceBox() {
    return document.getElementById("price-box-container");
  }
  function findPreviousPriceWrapper() {
    const priceBox = findPriceBox();
    if (!priceBox?.firstElementChild?.firstElementChild) {
      return null;
    }
    return priceBox.firstElementChild.firstElementChild.children[0] ?? null;
  }
  function findCurrentPriceWrapper() {
    const priceBox = findPriceBox();
    if (!priceBox?.firstElementChild?.firstElementChild) {
      return null;
    }
    return priceBox.firstElementChild.firstElementChild.children[1] ?? null;
  }
  function findPriceBoxInstallmentParagraph() {
    const priceBox = findPriceBox();
    if (!priceBox?.firstElementChild) {
      return null;
    }
    const installmentSection = priceBox.firstElementChild.children[1];
    if (!installmentSection) {
      return null;
    }
    return installmentSection.querySelector("p.font-semibold.typo-body-medium");
  }
  function findModalComponents() {
    return document.querySelectorAll(
      '[role="dialog"][aria-modal="true"][data-ds-component="DS-Modal"], [role="dialog"][aria-modal="true"].olx-modal-content, [role="dialog"][aria-modal="true"].olx-modal__dialog'
    );
  }
  function isInstallmentsModal(modal) {
    const title = modal.querySelector("h4.typo-title-small");
    if (title?.textContent.trim() !== "Formas de pagamento") {
      return false;
    }
    const optionsHeading = [...modal.querySelectorAll("p.typo-body-medium.font-semibold")].find((paragraph) => paragraph.textContent.trim() === "Op\xE7\xF5es de parcelamento");
    if (!optionsHeading) {
      return false;
    }
    const creditCardLabel = [...modal.querySelectorAll("p.typo-body-small.font-semibold")].find((paragraph) => paragraph.textContent.trim() === "Parcelamento sem juros");
    if (!creditCardLabel) {
      return false;
    }
    const installmentList = modal.querySelector('[class*="installmentList"]');
    if (!installmentList) {
      return false;
    }
    const installmentItems = installmentList.querySelectorAll('[class*="installmentItem"]');
    if (installmentItems.length === 0) {
      return false;
    }
    return [...installmentItems].some((item) => /\d+x de R\$/i.test(item.textContent));
  }
  function findInstallmentsModal() {
    for (const modal of findModalComponents()) {
      if (isInstallmentsModal(modal)) {
        return modal;
      }
    }
    return null;
  }
  function findInstallmentsModalList() {
    const modal = findInstallmentsModal();
    if (!modal) {
      return null;
    }
    return modal.querySelector('[class*="installmentList"]');
  }
  function findInitialDataScript() {
    return document.getElementById("initial-data");
  }
  function findAlternateAdPageLink() {
    return document.querySelector('link[rel="alternate"][href^="olxapp://adpage/?id="]');
  }
  function findCanonicalLink() {
    return document.querySelector('link[rel="canonical"]');
  }

  // monkeypatches/ad_details/models.js
  var INTEREST_VALUE_EPSILON = 0.01;
  function roundCurrency(value) {
    return Math.round(value * 100) / 100;
  }
  function normalizeInterestValue(interestValue) {
    if (interestValue <= INTEREST_VALUE_EPSILON) {
      return 0;
    }
    return roundCurrency(interestValue);
  }
  var InstallmentsModalListItem = class _InstallmentsModalListItem {
    constructor(count, value, interestValue) {
      this.count = count;
      this.value = roundCurrency(value);
      this.interestValue = normalizeInterestValue(interestValue);
    }
    getTotal() {
      return roundCurrency(this.count * this.value);
    }
    hasInterest() {
      return this.interestValue > 0;
    }
    getInterestRate() {
      const baseValue = this.value - this.interestValue;
      if (this.interestValue <= 0 || baseValue <= 0) {
        return 0;
      }
      return this.interestValue / baseValue;
    }
    recalculateForPrice(newPrice) {
      const baseValue = roundCurrency(newPrice / this.count);
      const newValue = roundCurrency(baseValue + baseValue * this.getInterestRate());
      const newInterestValue = newValue - baseValue;
      return new _InstallmentsModalListItem(this.count, newValue, newInterestValue);
    }
    static fromParsed(count, value, productPrice) {
      const baseValue = productPrice ? roundCurrency(productPrice / count) : value;
      const interestValue = Math.max(0, value - baseValue);
      return new _InstallmentsModalListItem(count, value, interestValue);
    }
  };

  // monkeypatches/ad_details/getters.js
  function requireAdDetailsValue(value, message) {
    if (value === null || value === void 0) {
      throw new Error(message);
    }
    return value;
  }
  function parsePriceText(text) {
    if (!text?.trim()) {
      return null;
    }
    const normalized = text.replace(/R\$\s*/g, "").trim().replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }
  function isCurrentPageAnAdDetailsPage() {
    return Boolean(findPriceBox());
  }
  function isInstallmentsModalOpen() {
    return Boolean(findInstallmentsModal());
  }
  function parseListId(value) {
    const listId = Number(value);
    return Number.isInteger(listId) && listId > 0 ? listId : null;
  }
  function getAdIdFromInitialData() {
    const initialData = findInitialDataScript();
    if (!initialData?.dataset.json) {
      return null;
    }
    try {
      const payload = JSON.parse(initialData.dataset.json);
      return parseListId(payload?.ad?.listId);
    } catch {
      return null;
    }
  }
  function getAdIdFromAlternateLink() {
    const link = findAlternateAdPageLink();
    const match = link?.href.match(/[?&]id=(\d+)/);
    return match ? parseListId(match[1]) : null;
  }
  function getAdIdFromDataLayer() {
    const entry = window.dataLayer?.[0];
    const page = entry?.page;
    return parseListId(page?.detail?.list_id) ?? parseListId(page?.adDetail?.listId) ?? parseListId(entry?.listId);
  }
  function getAdIdFromUrl() {
    const href = findCanonicalLink()?.href ?? window.location.pathname;
    const match = href.match(/-(\d+)(?:\?|$|\/)/);
    return match ? parseListId(match[1]) : null;
  }
  function getAdId() {
    const adId = getAdIdFromInitialData() ?? getAdIdFromAlternateLink() ?? getAdIdFromDataLayer() ?? getAdIdFromUrl();
    return requireAdDetailsValue(adId, "Ad ID not found");
  }
  function parsePriceBoxInstallmentCount(text) {
    const match = text?.match(/^(\d+)x sem juros de/i);
    if (!match) {
      return null;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }
  function getPriceBoxInstallmentCount() {
    const installmentParagraph = findPriceBoxInstallmentParagraph();
    if (!installmentParagraph) {
      throw new Error("Price box installment paragraph not found");
    }
    return requireAdDetailsValue(
      parsePriceBoxInstallmentCount(installmentParagraph.textContent),
      "Price box installment count not found"
    );
  }
  function parseInstallmentsModalListItemRaw(item) {
    const label = item.querySelector("p.typo-body-small.font-semibold");
    if (!label) {
      return null;
    }
    const match = label.textContent.match(/^(\d+)x de R\$\s*([\d.,]+)/i);
    if (!match) {
      return null;
    }
    const count = Number(match[1]);
    const value = parsePriceText("R$ " + match[2]);
    if (!Number.isFinite(count) || value === null) {
      return null;
    }
    return { count, value };
  }
  function parseInstallmentsModalListItem(item, productPrice) {
    const parsed = parseInstallmentsModalListItemRaw(item);
    if (!parsed) {
      return null;
    }
    return InstallmentsModalListItem.fromParsed(parsed.count, parsed.value, productPrice);
  }
  function getInstallmentsModalList() {
    const installmentsList = findInstallmentsModalList();
    if (!installmentsList) {
      throw new Error("Installments modal list not found");
    }
    const items = [...installmentsList.querySelectorAll('[class*="installmentItem"]')];
    const rawItems = items.map(parseInstallmentsModalListItemRaw).filter(Boolean);
    if (rawItems.length === 0) {
      throw new Error("No installments found in installments modal list");
    }
    const productPrice = requireAdDetailsValue(
      rawItems.find((raw) => raw.count === 1)?.value,
      "1x installment not found in installments modal list"
    );
    const installments = items.map((item) => parseInstallmentsModalListItem(item, productPrice)).filter(Boolean);
    if (installments.length === 0) {
      throw new Error("Failed to parse installments modal list items");
    }
    return installments;
  }

  // monkeypatches/ad_details/setters.js
  var PREVIOUS_PRICE_WRAPPER_HTML = '<div class="flex gap-1 items-center"><span class="typo-body-medium font-semibold text-neutral-100" style="text-decoration: line-through;"></span></div>';
  var PREVIOUS_PRICE_SPAN_CLASSES = ["typo-body-medium", "font-semibold", "text-neutral-100"];
  var CURRENT_PRICE_SPAN_SELECTOR = ".typo-display-large, .typo-title-medium";
  function formatPrice(price) {
    return "R$ " + price;
  }
  function formatBrazilianPrice(price) {
    return Number(price).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  function restorePreviousPriceSpanStyles(span) {
    for (const className of PREVIOUS_PRICE_SPAN_CLASSES) {
      span.classList.add(className);
    }
    span.style.textDecoration = "line-through";
  }
  function hasPreviousPriceStyles(span) {
    const hasClasses = PREVIOUS_PRICE_SPAN_CLASSES.every((className) => span.classList.contains(className));
    const hasStrike = span.style.textDecoration.includes("line-through");
    return hasClasses && hasStrike;
  }
  function getPreviousPriceSpan(wrapper) {
    if (!wrapper.hasChildNodes()) {
      wrapper.innerHTML = PREVIOUS_PRICE_WRAPPER_HTML;
    }
    return wrapper.querySelector("span.typo-body-medium") ?? wrapper.querySelector("span");
  }
  function getCurrentPriceSpan(wrapper) {
    const styledSpan = wrapper.querySelector(CURRENT_PRICE_SPAN_SELECTOR);
    if (styledSpan) {
      return styledSpan;
    }
    const outerSpan = wrapper.querySelector("span");
    if (!outerSpan) {
      return null;
    }
    return outerSpan.querySelector("span") ?? outerSpan;
  }
  function setPreviousPrice(price) {
    const wrapper = findPreviousPriceWrapper();
    if (!wrapper) {
      return;
    }
    const span = getPreviousPriceSpan(wrapper);
    if (!span) {
      return;
    }
    span.textContent = formatPrice(price);
    if (!hasPreviousPriceStyles(span)) {
      restorePreviousPriceSpanStyles(span);
    }
  }
  function setCurrentPrice(price) {
    const wrapper = findCurrentPriceWrapper();
    if (!wrapper) {
      return;
    }
    const span = getCurrentPriceSpan(wrapper);
    if (!span) {
      return;
    }
    const originalClassName = span.className;
    span.textContent = formatPrice(price);
    span.className = originalClassName;
  }
  function setPriceBoxInstallmentValue(value) {
    const installmentParagraph = findPriceBoxInstallmentParagraph();
    if (!installmentParagraph) {
      return;
    }
    const prefixMatch = installmentParagraph.textContent.match(/^(\d+x sem juros de R\$\s*)/i);
    if (!prefixMatch) {
      return;
    }
    installmentParagraph.textContent = prefixMatch[1] + formatBrazilianPrice(value);
  }
  function isValidInstallmentsModalItem(installment) {
    return installment instanceof InstallmentsModalListItem;
  }
  function resolveInstallmentsModalItemClassName(list) {
    const existingItem = list.querySelector('[class*="installmentItem"]');
    if (existingItem) {
      return existingItem.className;
    }
    const modalItem = list.closest('[role="dialog"]')?.querySelector('[class*="installmentItem"]');
    return modalItem?.className ?? "";
  }
  function buildInstallmentsModalListItem(installment, itemClassName) {
    const item = document.createElement("div");
    item.className = itemClassName;
    const leftColumn = document.createElement("div");
    const label = document.createElement("p");
    label.className = "typo-body-small font-semibold";
    label.textContent = `${installment.count}x de R$\xA0${formatBrazilianPrice(installment.value)}`;
    const interestLabel = document.createElement("span");
    interestLabel.className = "typo-caption";
    interestLabel.textContent = installment.hasInterest() ? "" : "Sem Juros";
    const totalLabel = document.createElement("span");
    totalLabel.className = "typo-caption";
    totalLabel.textContent = `R$\xA0${formatBrazilianPrice(installment.getTotal())}`;
    leftColumn.appendChild(label);
    leftColumn.appendChild(interestLabel);
    item.appendChild(leftColumn);
    item.appendChild(totalLabel);
    return item;
  }
  function setInstallmentsModalList(installments) {
    if (!Array.isArray(installments) || !installments.every(isValidInstallmentsModalItem)) {
      return;
    }
    const installmentsList = findInstallmentsModalList();
    if (!installmentsList) {
      return;
    }
    const itemClassName = resolveInstallmentsModalItemClassName(installmentsList);
    installmentsList.replaceChildren();
    for (const installment of installments) {
      installmentsList.appendChild(buildInstallmentsModalListItem(installment, itemClassName));
    }
  }

  // monkeypatches/ad_details/patch.js
  function recalculateInstallmentsModalList(installmentsList, newPrice) {
    if (!newPrice) {
      return null;
    }
    return installmentsList.map((installment) => installment.recalculateForPrice(newPrice));
  }
  async function patchAdDetailsAsync() {
    if (!isCurrentPageAnAdDetailsPage()) {
      return;
    }
    const adId = getAdId();
    const adPatch = await getAdPatchAsync(adId);
    if (!adPatch) {
      return;
    }
    const newPreviousPrice = adPatch.previousPrice;
    if (newPreviousPrice) {
      setPreviousPrice(newPreviousPrice);
    }
    const newCurrentPrice = adPatch.currentPrice;
    if (newCurrentPrice) {
      setCurrentPrice(newCurrentPrice);
    }
    const priceBoxInstallmentsCount = getPriceBoxInstallmentCount();
    const shouldUpdatePriceBoxInstallmentValue = newCurrentPrice && priceBoxInstallmentsCount;
    if (shouldUpdatePriceBoxInstallmentValue) {
      const newPriceBoxInstallmentValue = Math.round(newCurrentPrice / priceBoxInstallmentsCount);
      setPriceBoxInstallmentValue(newPriceBoxInstallmentValue);
    }
    const installmentsModalList = isInstallmentsModalOpen() ? getInstallmentsModalList() : [];
    const shouldUpdateInstallmentsModalList = installmentsModalList.length > 0 && newCurrentPrice;
    if (shouldUpdateInstallmentsModalList) {
      const newInstallmentsModalList = recalculateInstallmentsModalList(
        installmentsModalList,
        newCurrentPrice
      );
      setInstallmentsModalList(newInstallmentsModalList);
    }
  }

  // monkeypatches/checkout_review/finders.js
  var COUPON_BOX_LABEL = "Cupom de desconto";
  var PAYMENT_SECTION_HEADING = "Forma de pagamento";
  var ADD_COUPON_BUTTON_LABEL = "Adicionar";
  var DIGITAL_PAYMENTS_HEADING = "PAGAMENTOS DIGITAIS";
  var CREDIT_CARD_HEADING = "CART\xC3O DE CR\xC9DITO";
  var ADD_CREDIT_CARD_LABEL = "Adicionar cart\xE3o de cr\xE9dito";
  var PIX_PAYMENT_NAME = "Pix";
  var PAYMENT_METHOD_SECTION_HEADING = "M\xE9todo de pagamento";
  var PRODUCT_VALUE_LABEL = "Valor do Produto";
  var TOTAL_TO_PAY_LABEL = "Total a pagar";
  var CHECKOUT_CONFIRMATION_MODAL_HEADING = "Finalize a compra";
  var CONFIRM_PAYMENT_BUTTON_LABEL = "Finalizar compra";
  var TEXT_ELEMENT_SELECTOR = 'span, p, label, h1, h2, h3, h4, [data-ds-component="DS-Text"]';
  var PAYMENT_METHOD_TOTAL_SPAN_SELECTOR = "span.typo-body-medium.font-bold";
  var PAYMENT_SUMMARY_TOTAL_SPAN_SELECTOR = "span.typo-body-large.font-bold";
  var BRAZILIAN_PRICE_PATTERN = /^R\$\s*.+/;
  var PAYMENT_RADIO_INPUT_SELECTOR = 'input.olx-core-radio__input[type="radio"], input[type="radio"]';
  var ADD_COUPON_CONTROL_SELECTOR = 'button[data-ds-component="DS-Link"], a[data-ds-component="DS-Link"]';
  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function findElementsWithExactText(text, root = document) {
    const matches = [];
    for (const element of root.querySelectorAll(TEXT_ELEMENT_SELECTOR)) {
      if (normalizeText(element.textContent) !== text) {
        continue;
      }
      const hasExactChild = [...element.querySelectorAll(TEXT_ELEMENT_SELECTOR)].some((child) => child !== element && normalizeText(child.textContent) === text);
      if (hasExactChild) {
        continue;
      }
      matches.push(element);
    }
    return matches;
  }
  function getSearchDocuments() {
    const documents = [document];
    for (const iframe of document.querySelectorAll("iframe")) {
      try {
        if (iframe.contentDocument) {
          documents.push(iframe.contentDocument);
        }
      } catch {
      }
    }
    return documents;
  }
  function findPaymentSectionRoots(searchRoot = document) {
    const roots = /* @__PURE__ */ new Set();
    for (const heading of findElementsWithExactText(PAYMENT_SECTION_HEADING, searchRoot)) {
      const root = heading.closest(".relative") ?? heading.parentElement;
      if (root) {
        roots.add(root);
      }
    }
    return [...roots];
  }
  function isCouponBoxElement(element) {
    if (!(element instanceof HTMLElement) || element.closest('[data-testid="coupon-modal"]')) {
      return false;
    }
    if (element.querySelector(PAYMENT_RADIO_INPUT_SELECTOR)) {
      return false;
    }
    const hasLabel = [...element.querySelectorAll("span")].some((span) => normalizeText(span.textContent) === COUPON_BOX_LABEL);
    if (!hasLabel) {
      return false;
    }
    const addButton = [...element.querySelectorAll(ADD_COUPON_CONTROL_SELECTOR)].find((control) => normalizeText(control.textContent) === ADD_COUPON_BUTTON_LABEL);
    if (!addButton) {
      return false;
    }
    return element.querySelector(":scope > svg") !== null;
  }
  function findCouponBoxFromLabel(label) {
    let match = null;
    for (let candidate = label.parentElement; candidate; candidate = candidate.parentElement) {
      if (isCouponBoxElement(candidate)) {
        match = candidate;
        continue;
      }
      if (match) {
        break;
      }
    }
    return match;
  }
  function findCouponBox() {
    for (const searchDocument of getSearchDocuments()) {
      const roots = [...findPaymentSectionRoots(searchDocument), searchDocument];
      for (const root of roots) {
        for (const label of findElementsWithExactText(COUPON_BOX_LABEL, root)) {
          if (label.closest('[data-testid="coupon-modal"]')) {
            continue;
          }
          const box = findCouponBoxFromLabel(label);
          if (box) {
            return box;
          }
        }
      }
    }
    return null;
  }
  function hasNormalizedSpanText(element, text) {
    return findElementsWithExactText(text, element).length > 0;
  }
  function isPaymentOptionsWrapper(element) {
    if (!(element instanceof HTMLElement) || element.closest('[data-testid="summary"]')) {
      return false;
    }
    if (hasNormalizedSpanText(element, COUPON_BOX_LABEL)) {
      return false;
    }
    if (!hasNormalizedSpanText(element, DIGITAL_PAYMENTS_HEADING)) {
      return false;
    }
    if (element.querySelector(PAYMENT_RADIO_INPUT_SELECTOR) === null) {
      return false;
    }
    return hasNormalizedSpanText(element, PIX_PAYMENT_NAME);
  }
  function findPaymentOptionsWrapperFromHeading(heading) {
    let match = null;
    for (let candidate = heading.parentElement; candidate; candidate = candidate.parentElement) {
      if (isPaymentOptionsWrapper(candidate)) {
        match = candidate;
        continue;
      }
      if (match) {
        break;
      }
    }
    return match;
  }
  function findPaymentOptionsWrapperFromPix(root) {
    for (const pixLabel of findElementsWithExactText(PIX_PAYMENT_NAME, root)) {
      if (pixLabel.closest('[data-testid="summary"]')) {
        continue;
      }
      let match = null;
      for (let candidate = pixLabel.parentElement; candidate && root.contains(candidate); candidate = candidate.parentElement) {
        if (isPaymentOptionsWrapper(candidate)) {
          match = candidate;
          continue;
        }
        if (match) {
          break;
        }
      }
      if (match) {
        return match;
      }
    }
    return null;
  }
  function findPaymentOptionsWrapper() {
    for (const searchDocument of getSearchDocuments()) {
      const roots = [...findPaymentSectionRoots(searchDocument), searchDocument];
      for (const root of roots) {
        for (const heading of findElementsWithExactText(DIGITAL_PAYMENTS_HEADING, root)) {
          if (heading.closest('[data-testid="summary"]')) {
            continue;
          }
          const wrapper = findPaymentOptionsWrapperFromHeading(heading);
          if (wrapper) {
            return wrapper;
          }
        }
        const wrapperFromPix = findPaymentOptionsWrapperFromPix(root);
        if (wrapperFromPix) {
          return wrapperFromPix;
        }
      }
    }
    return null;
  }
  function findPaymentMethodName(card) {
    const nameSpan = card.querySelector("div.w-full span.font-semibold") ?? card.querySelector("span.font-semibold");
    if (!nameSpan) {
      return null;
    }
    return normalizeText(nameSpan.textContent);
  }
  function findPaymentMethodCardFromInput(input) {
    let candidate = input.closest("label")?.parentElement ?? input.parentElement;
    while (candidate) {
      if (findPaymentMethodName(candidate)) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  }
  function findDigitalPaymentMethodCards(wrapper) {
    if (!wrapper) {
      return [];
    }
    const cards = [];
    for (const input of wrapper.querySelectorAll(PAYMENT_RADIO_INPUT_SELECTOR)) {
      const card = findPaymentMethodCardFromInput(input);
      const name = card ? findPaymentMethodName(card) : null;
      if (!card || !name) {
        continue;
      }
      cards.push({ name, card, input });
    }
    return cards;
  }
  function isCreditCardSection(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (!hasNormalizedSpanText(element, CREDIT_CARD_HEADING)) {
      return false;
    }
    return element.querySelector("input.olx-core-toggle-switch") !== null;
  }
  function findCreditCardSection(wrapper) {
    if (!wrapper) {
      return null;
    }
    for (const heading of findElementsWithExactText(CREDIT_CARD_HEADING, wrapper)) {
      for (let candidate = heading.parentElement; candidate && wrapper.contains(candidate); candidate = candidate.parentElement) {
        if (isCreditCardSection(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }
  function findAddCreditCardContainer(wrapper) {
    if (!wrapper) {
      return null;
    }
    for (const container of wrapper.querySelectorAll('[data-ds-component="DS-Container"]')) {
      if (hasNormalizedSpanText(container, ADD_CREDIT_CARD_LABEL)) {
        return container;
      }
    }
    return null;
  }
  function isBrazilianPriceText(text) {
    return BRAZILIAN_PRICE_PATTERN.test(normalizeText(text));
  }
  function findCheckoutSummaryArticles(searchRoot = document) {
    return [...searchRoot.querySelectorAll('[data-testid="summary"]')];
  }
  function findCheckoutSummaryPaymentMethodTotalSpanInRoot(summary) {
    for (const heading of findElementsWithExactText(PAYMENT_METHOD_SECTION_HEADING, summary)) {
      const section = heading.closest(".flex.flex-col") ?? heading.parentElement;
      if (!section) {
        continue;
      }
      const listItem = section.querySelector('[role="listitem"]');
      const span = listItem?.querySelector(PAYMENT_METHOD_TOTAL_SPAN_SELECTOR);
      if (span && isBrazilianPriceText(span.textContent)) {
        return span;
      }
    }
    return null;
  }
  function isCheckoutSummaryListWrapper(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const gridChildren = [...element.children].filter((child) => child.matches(".grid"));
    if (gridChildren.length < 2) {
      return false;
    }
    return hasNormalizedSpanText(element, PRODUCT_VALUE_LABEL);
  }
  function findCheckoutSummaryListWrapperFromLabel(label) {
    for (let candidate = label.parentElement; candidate; candidate = candidate.parentElement) {
      if (isCheckoutSummaryListWrapper(candidate)) {
        return candidate;
      }
    }
    return null;
  }
  function findCheckoutSummaryListWrapperInRoot(summary) {
    for (const label of findElementsWithExactText(PRODUCT_VALUE_LABEL, summary)) {
      const wrapper = findCheckoutSummaryListWrapperFromLabel(label);
      if (wrapper) {
        return wrapper;
      }
    }
    return null;
  }
  function findCheckoutSummaryTotalSpanFromLabel(label) {
    const row = label.closest(".mt-0-5");
    if (!row || !hasNormalizedSpanText(row, TOTAL_TO_PAY_LABEL)) {
      return null;
    }
    const spans = row.querySelectorAll(PAYMENT_SUMMARY_TOTAL_SPAN_SELECTOR);
    for (const span of spans) {
      if (normalizeText(span.textContent) === TOTAL_TO_PAY_LABEL) {
        continue;
      }
      if (isBrazilianPriceText(span.textContent)) {
        return span;
      }
    }
    return null;
  }
  function findCheckoutSummaryTotalSpanInRoot(summary) {
    for (const label of findElementsWithExactText(TOTAL_TO_PAY_LABEL, summary)) {
      const span = findCheckoutSummaryTotalSpanFromLabel(label);
      if (span) {
        return span;
      }
    }
    return null;
  }
  function findCheckoutSummaryRowValueSpan(valueColumn) {
    if (!(valueColumn instanceof HTMLElement)) {
      return null;
    }
    const spans = [...valueColumn.querySelectorAll("span.typo-body-small")];
    const boldSpan = spans.find((span) => span.classList.contains("font-bold") && !span.classList.contains("line-through"));
    if (boldSpan) {
      return boldSpan;
    }
    const freeSpan = spans.find((span) => span.classList.contains("text-feedback-success-100"));
    if (freeSpan) {
      return freeSpan;
    }
    return spans.find((span) => !span.classList.contains("line-through")) ?? spans[0] ?? null;
  }
  function findCheckoutSummaryRowStrikeSpan(valueColumn) {
    if (!(valueColumn instanceof HTMLElement)) {
      return null;
    }
    return valueColumn.querySelector("span.typo-body-small.line-through");
  }
  function findInCheckoutSummaryArticles(findInRoot) {
    for (const searchDocument of getSearchDocuments()) {
      for (const summary of findCheckoutSummaryArticles(searchDocument)) {
        const match = findInRoot(summary);
        if (match) {
          return match;
        }
      }
    }
    return null;
  }
  function findCheckoutSummaryListWrapper() {
    return findInCheckoutSummaryArticles(findCheckoutSummaryListWrapperInRoot);
  }
  function findCheckoutSummaryRoots() {
    const roots = [];
    for (const searchDocument of getSearchDocuments()) {
      for (const summary of findCheckoutSummaryArticles(searchDocument)) {
        roots.push(summary);
      }
      const modal = findCheckoutConfirmationModalInRoot(searchDocument);
      if (modal) {
        roots.push(modal);
      }
    }
    return roots;
  }
  function isVisibleCheckoutConfirmationModal(element) {
    return element.getAttribute("data-show") === "true" && element.getAttribute("aria-hidden") === "false";
  }
  function isCheckoutConfirmationModal(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element.getAttribute("data-ds-component") !== "DS-Modal") {
      return false;
    }
    if (!element.classList.contains("olx-modal--default")) {
      return false;
    }
    if (element.classList.contains("olx-modal--side-sheet")) {
      return false;
    }
    if (element.closest('[data-testid="coupon-modal"]') || element.dataset.testid === "coupon-modal") {
      return false;
    }
    return hasNormalizedSpanText(element, CHECKOUT_CONFIRMATION_MODAL_HEADING);
  }
  function findCheckoutConfirmationModalInRoot(searchRoot) {
    const matches = [];
    for (const modal of searchRoot.querySelectorAll('[data-ds-component="DS-Modal"].olx-modal--default')) {
      if (isCheckoutConfirmationModal(modal)) {
        matches.push(modal);
      }
    }
    return matches.find(isVisibleCheckoutConfirmationModal) ?? matches[0] ?? null;
  }
  function findCheckoutConfirmationModal() {
    for (const searchDocument of getSearchDocuments()) {
      const modal = findCheckoutConfirmationModalInRoot(searchDocument);
      if (modal) {
        return modal;
      }
    }
    return null;
  }
  function findConfirmPaymentButtonInRoot(searchRoot) {
    for (const label of findElementsWithExactText(CONFIRM_PAYMENT_BUTTON_LABEL, searchRoot)) {
      const button = label.closest("button.olx-core-loading-button");
      if (button) {
        return button;
      }
    }
    return null;
  }
  function findConfirmPaymentButton() {
    const modal = findCheckoutConfirmationModal();
    if (!modal) {
      return null;
    }
    return findConfirmPaymentButtonInRoot(modal);
  }

  // monkeypatches/checkout_review/models.js
  function roundCurrency2(value) {
    return Math.round(value * 100) / 100;
  }
  function normalizePrice2(value) {
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    return roundCurrency2(value);
  }
  function normalizeName(name) {
    if (typeof name !== "string") {
      return "";
    }
    return name.replace(/\s+/g, " ").trim();
  }
  function normalizeValueText(valueText) {
    if (typeof valueText !== "string") {
      return "";
    }
    return valueText.replace(/\s+/g, " ").trim();
  }
  function isCheckoutSummaryDiscountRow(name, valueText = "") {
    const normalizedName = normalizeName(name).toLowerCase();
    if (normalizedName.includes("desconto")) {
      return true;
    }
    return normalizeValueText(valueText).startsWith("-");
  }
  var CheckoutSummaryExtraCost = class _CheckoutSummaryExtraCost {
    constructor(name, value, discountValue = value) {
      this.name = normalizeName(name);
      this.value = normalizePrice2(value);
      this.discountValue = normalizePrice2(discountValue);
    }
    getChargeValue() {
      return this.discountValue;
    }
    isFree() {
      return this.discountValue === 0;
    }
    hasDiscount() {
      return this.discountValue !== this.value;
    }
    static fromParsed(name, value, discountValue = value) {
      return new _CheckoutSummaryExtraCost(name, value, discountValue);
    }
  };
  var CheckoutSummary = class _CheckoutSummary {
    constructor(productPrice, extraCosts) {
      this.productPrice = normalizePrice2(productPrice);
      this.extraCosts = Array.isArray(extraCosts) ? extraCosts.filter((cost) => cost instanceof CheckoutSummaryExtraCost) : [];
    }
    getExtraCostsTotal() {
      return roundCurrency2(
        this.extraCosts.reduce((total, cost) => total + cost.getChargeValue(), 0)
      );
    }
    getTotal() {
      return roundCurrency2(this.productPrice + this.getExtraCostsTotal());
    }
    static fromParsed(productPrice, extraCosts) {
      const costs = Array.isArray(extraCosts) ? extraCosts.map((cost) => {
        if (!cost || typeof cost.name !== "string") {
          return null;
        }
        return CheckoutSummaryExtraCost.fromParsed(
          cost.name,
          cost.value,
          cost.discountValue ?? cost.value
        );
      }).filter((cost) => cost && cost.name !== "") : [];
      return new _CheckoutSummary(productPrice, costs);
    }
  };

  // monkeypatches/checkout_review/getters.js
  var PRODUCT_VALUE_LABEL2 = "Valor do Produto";
  var FREE_VALUE_LABEL = "Gr\xE1tis";
  var CHECKOUT_REVIEW_PAGE_TYPES = /* @__PURE__ */ new Set(["olx_pay_summary"]);
  function isCheckoutReviewPageFromDom() {
    return Boolean(findPaymentOptionsWrapper());
  }
  function isCheckoutReviewPageFromDataLayer() {
    const pageType = window.dataLayer?.[0]?.page?.pageType;
    return CHECKOUT_REVIEW_PAGE_TYPES.has(pageType);
  }
  function getNextDataInitialState() {
    const script = document.getElementById("__NEXT_DATA__");
    if (!script?.textContent) {
      return null;
    }
    try {
      const data = JSON.parse(script.textContent);
      return data?.props?.pageProps?.initialState ?? null;
    } catch {
      return null;
    }
  }
  function isCheckoutReviewPageFromNextData() {
    const initialState = getNextDataInitialState();
    if (!initialState) {
      return false;
    }
    const checkoutLoaded = initialState.checkoutStore?.state === "loaded";
    const hasPaymentOptions = Array.isArray(initialState.paymentStore?.payments) && initialState.paymentStore.payments.length > 0;
    return checkoutLoaded && hasPaymentOptions;
  }
  function isCurrentPageACheckoutReviewPage() {
    if (isCheckoutReviewPageFromDom()) {
      return true;
    }
    if (isCheckoutReviewPageFromDataLayer()) {
      return true;
    }
    return isCheckoutReviewPageFromNextData();
  }
  function requireCheckoutReviewValue(value, message) {
    if (value === null || value === void 0) {
      throw new Error(message);
    }
    return value;
  }
  function parsePriceText2(text) {
    if (!text?.trim()) {
      return null;
    }
    const normalized = text.replace(/R\$\s*/g, "").trim().replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }
  function isFreeValueText(text) {
    const normalized = normalizeText(text).toLowerCase();
    return normalized === FREE_VALUE_LABEL.toLowerCase() || normalized === "frete gr\xE1tis";
  }
  function parseCheckoutSummaryRow(gridRow) {
    const innerRow = gridRow.querySelector(".mt-0-5");
    if (!innerRow) {
      return null;
    }
    const columns = [...innerRow.children].filter((child) => child.classList.contains("flex"));
    const nameColumn = columns.find((column) => column.classList.contains("flex-1"));
    const valueColumn = columns.find((column) => !column.classList.contains("flex-1"));
    const nameSpan = nameColumn?.querySelector("span.typo-body-small");
    const strikeSpan = findCheckoutSummaryRowStrikeSpan(valueColumn);
    const valueSpan = findCheckoutSummaryRowValueSpan(valueColumn);
    if (!nameSpan || !valueSpan) {
      return null;
    }
    const name = normalizeText(nameSpan.textContent);
    if (!name) {
      return null;
    }
    const valueText = normalizeText(valueSpan.textContent);
    if (isCheckoutSummaryDiscountRow(name, valueText)) {
      return null;
    }
    if (isFreeValueText(valueText)) {
      return { name, value: 0, discountValue: 0 };
    }
    if (strikeSpan) {
      const value2 = parsePriceText2(strikeSpan.textContent);
      const discountValue = parsePriceText2(valueSpan.textContent);
      if (value2 === null || discountValue === null) {
        return null;
      }
      return { name, value: value2, discountValue };
    }
    const value = parsePriceText2(valueText);
    if (value === null) {
      return null;
    }
    return { name, value, discountValue: value };
  }
  function parseListId2(value) {
    const listId = Number(value);
    return Number.isInteger(listId) && listId > 0 ? listId : null;
  }
  function getNextDataPageProps() {
    const script = document.getElementById("__NEXT_DATA__");
    if (!script?.textContent) {
      return null;
    }
    try {
      const data = JSON.parse(script.textContent);
      return data?.props?.pageProps ?? null;
    } catch {
      return null;
    }
  }
  function getAdIdFromNextData() {
    const pageProps = getNextDataPageProps();
    if (!pageProps) {
      return null;
    }
    return parseListId2(pageProps.query?.listId) ?? parseListId2(pageProps.initialState?.checkoutStore?.ad?.listId) ?? parseListId2(pageProps.initialState?.checkoutStore?.listId);
  }
  function getAdIdFromDataLayer2() {
    const entry = window.dataLayer?.[0];
    const page = entry?.page;
    return parseListId2(page?.details?.list_id) ?? parseListId2(page?.detail?.list_id) ?? parseListId2(page?.adDetail?.listId) ?? parseListId2(entry?.listId);
  }
  function getAdIdFromUrl2() {
    const params = new URLSearchParams(window.location.search);
    return parseListId2(params.get("listId")) ?? parseListId2(params.get("list_id"));
  }
  function getAdId2() {
    const adId = getAdIdFromNextData() ?? getAdIdFromDataLayer2() ?? getAdIdFromUrl2();
    return requireCheckoutReviewValue(adId, "Ad ID not found");
  }
  function getCheckoutSummary() {
    const wrapper = findCheckoutSummaryListWrapper();
    if (!wrapper) {
      throw new Error("Checkout summary list wrapper not found");
    }
    const rows = [...wrapper.children].filter((child) => child.matches(".grid"));
    const parsedRows = rows.map(parseCheckoutSummaryRow).filter(Boolean);
    if (parsedRows.length === 0) {
      throw new Error("Failed to parse checkout summary rows");
    }
    const productRow = parsedRows.find((row) => row.name === PRODUCT_VALUE_LABEL2);
    const productPrice = requireCheckoutReviewValue(
      productRow?.value,
      "Product price not found in checkout summary"
    );
    const extraCosts = parsedRows.filter((row) => row.name !== PRODUCT_VALUE_LABEL2).map(({ name, value, discountValue }) => ({ name, value, discountValue }));
    return CheckoutSummary.fromParsed(productPrice, extraCosts);
  }
  function getPixPaymentValue() {
    return getCheckoutSummary().getTotal();
  }

  // monkeypatches/checkout_review/setters.js
  var PRODUCT_VALUE_LABEL3 = "Valor do Produto";
  var HIDDEN_DISCOUNT_ROW_ATTR = "data-olx-patch-hidden-discount";
  var FREE_VALUE_LABEL2 = "Gr\xE1tis";
  var FREE_VALUE_SPAN_CLASSES = ["typo-body-small", "font-bold", "text-feedback-success-100"];
  var PAID_VALUE_SPAN_CLASSES = ["typo-body-small", "font-bold"];
  function isValidCheckoutSummary(summary) {
    return summary instanceof CheckoutSummary;
  }
  function isValidExtraCost(extraCost) {
    return extraCost instanceof CheckoutSummaryExtraCost;
  }
  function formatBrazilianPrice2(price) {
    return Number(price).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  function formatSummaryPrice(price) {
    return `R$ ${formatBrazilianPrice2(price)}`;
  }
  function getCheckoutSummaryRowParts(gridRow, index) {
    const innerRow = gridRow.querySelector(".mt-0-5");
    if (!innerRow) {
      return null;
    }
    const columns = [...innerRow.children].filter((child) => child.classList.contains("flex"));
    const nameColumn = columns.find((column) => column.classList.contains("flex-1"));
    const valueColumn = columns.find((column) => !column.classList.contains("flex-1"));
    const nameSpan = nameColumn?.querySelector("span.typo-body-small");
    const valueSpan = findCheckoutSummaryRowValueSpan(valueColumn);
    if (!nameSpan || !valueSpan || !valueColumn) {
      return null;
    }
    const name = normalizeText(nameSpan.textContent);
    if (!name) {
      return null;
    }
    return { index, gridRow, name, valueColumn, valueSpan };
  }
  function getCheckoutSummaryRows(wrapper) {
    return [...wrapper.children].filter((child) => child.matches(".grid")).map((row, index) => getCheckoutSummaryRowParts(row, index)).filter(Boolean);
  }
  function restoreFreeValueSpanStyles(span) {
    span.className = FREE_VALUE_SPAN_CLASSES.join(" ");
  }
  function restorePaidValueSpanStyles(span) {
    span.className = PAID_VALUE_SPAN_CLASSES.join(" ");
  }
  function hideCheckoutSummaryDiscountRow(gridRow) {
    if (!(gridRow instanceof HTMLElement)) {
      return;
    }
    gridRow.style.display = "none";
    gridRow.setAttribute(HIDDEN_DISCOUNT_ROW_ATTR, "true");
  }
  function showCheckoutSummaryRow(gridRow) {
    if (!(gridRow instanceof HTMLElement)) {
      return;
    }
    gridRow.style.display = "";
    gridRow.removeAttribute(HIDDEN_DISCOUNT_ROW_ATTR);
  }
  function clearCheckoutSummaryRowStrikeText(valueColumn) {
    const strikeSpan = findCheckoutSummaryRowStrikeSpan(valueColumn);
    if (strikeSpan) {
      strikeSpan.textContent = "";
    }
  }
  function setCheckoutSummaryProductValue(valueColumn, price) {
    const valueSpan = findCheckoutSummaryRowValueSpan(valueColumn);
    if (!valueSpan) {
      return;
    }
    clearCheckoutSummaryRowStrikeText(valueColumn);
    valueSpan.textContent = formatSummaryPrice(price);
    if (valueSpan.classList.contains("text-feedback-success-100")) {
      restorePaidValueSpanStyles(valueSpan);
    }
  }
  function setCheckoutSummaryExtraCostValue(valueColumn, extraCost) {
    if (!isValidExtraCost(extraCost)) {
      return;
    }
    const strikeSpan = findCheckoutSummaryRowStrikeSpan(valueColumn);
    const valueSpan = findCheckoutSummaryRowValueSpan(valueColumn);
    if (!valueSpan) {
      return;
    }
    if (extraCost.isFree()) {
      clearCheckoutSummaryRowStrikeText(valueColumn);
      valueSpan.textContent = FREE_VALUE_LABEL2;
      if (!valueSpan.classList.contains("text-feedback-success-100")) {
        restoreFreeValueSpanStyles(valueSpan);
      }
      return;
    }
    if (extraCost.hasDiscount()) {
      if (strikeSpan) {
        strikeSpan.textContent = formatSummaryPrice(extraCost.value);
      }
      valueSpan.textContent = formatSummaryPrice(extraCost.discountValue);
      restorePaidValueSpanStyles(valueSpan);
      return;
    }
    clearCheckoutSummaryRowStrikeText(valueColumn);
    valueSpan.textContent = formatSummaryPrice(extraCost.value);
    if (valueSpan.classList.contains("text-feedback-success-100")) {
      restorePaidValueSpanStyles(valueSpan);
    }
  }
  function setCheckoutSummaryListValues(wrapper, summary) {
    const rows = getCheckoutSummaryRows(wrapper);
    if (rows.length === 0) {
      return;
    }
    const productRow = rows[0];
    if (productRow.index !== 0 || productRow.name !== PRODUCT_VALUE_LABEL3) {
      return;
    }
    setCheckoutSummaryProductValue(productRow.valueColumn, summary.productPrice);
    showCheckoutSummaryRow(productRow.gridRow);
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (isCheckoutSummaryDiscountRow(row.name, row.valueSpan.textContent)) {
        hideCheckoutSummaryDiscountRow(row.gridRow);
        continue;
      }
      showCheckoutSummaryRow(row.gridRow);
      const extraCost = summary.extraCosts.find((cost) => cost.name === row.name);
      if (!isValidExtraCost(extraCost)) {
        continue;
      }
      setCheckoutSummaryExtraCostValue(row.valueColumn, extraCost);
    }
  }
  function setCheckoutSummaryPriceSpan(span, price) {
    if (!span) {
      return;
    }
    span.textContent = formatSummaryPrice(price);
  }
  function setCheckoutSummaryInRoot(root, summary) {
    const listWrapper = findCheckoutSummaryListWrapperInRoot(root);
    if (listWrapper) {
      setCheckoutSummaryListValues(listWrapper, summary);
    }
    const total = summary.getTotal();
    setCheckoutSummaryPriceSpan(findCheckoutSummaryPaymentMethodTotalSpanInRoot(root), total);
    setCheckoutSummaryPriceSpan(findCheckoutSummaryTotalSpanInRoot(root), total);
  }
  function setCheckoutSummary(summary) {
    if (!isValidCheckoutSummary(summary)) {
      return;
    }
    for (const root of findCheckoutSummaryRoots()) {
      setCheckoutSummaryInRoot(root, summary);
    }
  }

  // monkeypatches/checkout_review/patches/checkout_summary_patch.js
  var WARRANTY_RATE = 0.05;
  var DELIVERY_LABEL = "Entrega";
  function buildPatchedCheckoutSummary(originalSummary, adPatch) {
    const productPrice = adPatch.currentPrice;
    const warrantyValue = productPrice * WARRANTY_RATE;
    return CheckoutSummary.fromParsed(
      productPrice,
      originalSummary.extraCosts.map((cost) => {
        if (cost.name === DELIVERY_LABEL) {
          return {
            name: cost.name,
            value: cost.value,
            discountValue: cost.discountValue
          };
        }
        return {
          name: cost.name,
          value: warrantyValue,
          discountValue: warrantyValue
        };
      })
    );
  }
  function patchCheckoutSummaryValues(adPatch) {
    const originalSummary = getCheckoutSummary();
    setCheckoutSummary(buildPatchedCheckoutSummary(originalSummary, adPatch));
  }
  function patchCheckoutSummary(adPatch) {
    patchCheckoutSummaryValues(adPatch);
  }

  // monkeypatches/checkout_review/patches/coupon_box_patch.js
  function suppressCouponBox() {
    const couponBox = findCouponBox();
    if (!couponBox) {
      console.info("patchCouponBox: no coupon box found");
      return;
    }
    couponBox.style.display = "none";
  }
  function patchCouponBox() {
    suppressCouponBox();
  }

  // monkeypatches/checkout_review/expired_pix_illustration.js
  var EXPIRED_PIX_ILLUSTRATION_SVG = '<svg width="96" height="96" viewBox="0 0 96 96" fill="none"\r\n                                xmlns="http://www.w3.org/2000/svg">\r\n                                <g clip-path="url(#olx-patch-expired-pix-clip)">\r\n                                    <rect width="96" height="96" fill="white"></rect>\r\n                                    <path opacity="0.2"\r\n                                        d="M75.9089 92.2399L7.03821 81.004C3.85467 80.474 1.73231 77.506 2.2629 74.3261L13.4053 5.53276C13.9359 2.35279 16.9072 0.232811 20.0907 0.762806L88.9614 11.9987C92.145 12.5287 94.2673 15.4967 93.7368 18.6766L82.5943 87.3639C82.1699 90.5439 79.0924 92.7699 75.9089 92.2399Z"\r\n                                        fill="#F28000"></path>\r\n                                    <path\r\n                                        d="M65.1019 52.9627L58.2257 35.3735C57.4189 33.3192 57.702 30.418 59.7116 29.3552C60.3532 29.0049 60.9221 28.7516 61.6115 28.7414L58.2296 4.67822C57.9189 2.46747 55.793 0.858674 53.5065 1.18002L26.1534 5.02424C23.867 5.34559 22.2549 7.39303 22.5775 9.68881L30.5362 66.318C30.8469 68.5288 32.9729 70.1376 35.2594 69.8162L60.2413 66.3052C62.0071 59.2071 65.1019 52.9627 65.1019 52.9627Z"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M51.8699 22.1179C52.5918 27.2549 49.0239 32.0031 43.9007 32.7231C38.7774 33.4431 34.039 29.8624 33.317 24.7253C32.595 19.5882 36.163 14.8401 41.2862 14.1201C46.4094 13.4001 51.1479 16.9808 51.8699 22.1179Z"\r\n                                        fill="#E1E1E1"></path>\r\n                                    <path\r\n                                        d="M46.7158 26.3314C46.2125 26.4022 45.7116 26.2722 45.3057 25.9655L43.1106 24.3069C42.9565 24.19 42.7211 24.2236 42.6051 24.3779L40.9463 26.5854C40.6406 26.992 40.1949 27.255 39.6916 27.3258L39.3125 27.379L42.0925 29.4798C42.9607 30.1359 44.1945 29.9625 44.8483 29.0925L46.9476 26.2989L46.7158 26.3314Z"\r\n                                        fill="#F28000"></path>\r\n                                    <path\r\n                                        d="M38.7332 20.4949C39.2364 20.4242 39.7374 20.5542 40.1433 20.8608L42.3464 22.5259C42.505 22.6458 42.7322 22.6145 42.8519 22.4547L44.5046 20.2551C44.8104 19.8484 45.256 19.5854 45.7593 19.5147L45.991 19.4821L43.2031 17.3753C42.3349 16.7192 41.1011 16.8926 40.4473 17.7626L38.3541 20.5482L38.7332 20.4949Z"\r\n                                        fill="#F28000"></path>\r\n                                    <path\r\n                                        d="M48.2113 21.4302L46.5723 20.3719C46.5417 20.3876 46.5079 20.3995 46.4711 20.4046L45.8067 20.498C45.4631 20.5463 45.1438 20.714 44.9306 20.9581L43.258 22.8721C43.1015 23.0512 42.8783 23.1612 42.6444 23.1941C42.4102 23.227 42.1655 23.1827 41.9657 23.0539L39.8223 21.6699C39.5501 21.4941 39.1969 21.4209 38.8534 21.4691L38.0364 21.584C38.0016 21.5889 37.968 21.5863 37.9358 21.5806L36.6469 23.0555C35.9853 23.8125 36.1337 24.8683 36.9783 25.4137L38.6238 26.4761C38.6531 26.4618 38.6848 26.4501 38.7196 26.4452L39.5366 26.3304C39.8801 26.2821 40.1994 26.1144 40.4127 25.8703L42.0914 23.9494C42.3948 23.6024 42.9969 23.5176 43.3839 23.7679L45.5192 25.1464C45.7915 25.3224 46.1447 25.3956 46.4882 25.3473L47.1526 25.2539C47.1894 25.2487 47.2252 25.2508 47.259 25.2574L48.5427 23.7885C49.2043 23.0313 49.0559 21.9755 48.2113 21.4302Z"\r\n                                        fill="#F28000"></path>\r\n                                    <path\r\n                                        d="M78.122 49.7446C74.5278 43.8333 70.9455 38.0071 67.3513 32.0958C66.664 30.8918 65.9886 29.7728 64.6107 29.186C61.4078 27.902 58.0402 30.9765 58.8569 34.3301C59.5173 37.1854 61.0364 40.0067 62.0236 42.7293C63.3603 46.0965 64.6244 49.5606 65.9612 52.9277C63.535 57.1706 61.8699 61.9134 60.8943 66.6461L39.0457 69.7167C40.434 78.3658 51.8218 88.7311 51.8218 88.7311C54.4668 90.9606 57.2759 96.2019 57.2759 96.2019L84.2903 92.4052C82.4724 87.4582 81.6047 85.5859 80.9485 80.3022C80.1489 73.9982 80.6076 67.4306 80.8481 61.1538C80.8912 57.1592 80.2568 53.2597 78.122 49.7446Z"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M57.2869 96.2879C57.2869 96.2879 54.5385 90.8647 51.8327 88.8172C48.2573 86.1114 40.4449 78.4519 39.0566 69.8027"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M57.3834 96.9674C57.1293 97.0031 56.8514 96.8688 56.7308 96.6256C56.7189 96.5405 54.0791 91.2755 51.4819 89.3861C47.3147 86.1566 39.853 78.5344 38.4647 69.8853C38.4169 69.5452 38.6232 69.1694 38.9619 69.1218C39.3007 69.0742 39.6753 69.2816 39.7231 69.6218C41.0396 77.7607 48.2114 85.1635 52.27 88.2348C55.0724 90.3555 57.8089 95.6937 57.9294 95.9369C58.0619 96.2651 57.9403 96.629 57.6255 96.8467C57.5527 96.9436 57.4681 96.9555 57.3834 96.9674Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M59.9547 77.8971C57.399 65.857 65.1021 52.4619 65.1021 52.4619L58.1422 34.2775C57.3354 32.2232 58.2222 29.9308 60.1471 28.8799C62.1567 27.8171 64.6712 28.5042 65.8049 30.4259L77.2629 49.2787C79.06 52.2344 79.9614 55.576 80.016 59.0367C80.016 59.0367 79.4083 74.9897 80.1492 80.2615C80.675 84.0028 83.5278 92.0125 83.5278 92.0125"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M83.5405 92.7047C83.2864 92.7404 82.9238 92.6179 82.876 92.2778C82.7435 91.9496 80.0112 84.183 79.4735 80.3567C78.7325 75.0849 79.3273 59.654 79.413 59.035C79.3823 55.7444 78.4929 52.4877 76.7077 49.6171L65.2617 30.8493C64.2485 29.1708 62.0966 28.6062 60.4138 29.5364C58.8038 30.3696 58.0505 32.383 58.7249 34.1091L65.6847 52.2935C65.7933 52.4517 65.7445 52.7187 65.6717 52.8156C65.599 52.9125 58.0414 66.1138 60.5493 77.8138C60.5971 78.1539 60.3909 78.5298 60.0521 78.5774C59.7134 78.625 59.3388 78.4175 59.291 78.0774C56.8309 66.7175 63.3105 54.4481 64.4145 52.4721L57.5871 34.6159C56.6597 32.3184 57.6681 29.6621 59.9198 28.4786C62.2561 27.2832 65.1214 28.0077 66.4722 30.2457L77.9063 48.9284C79.7153 51.9691 80.7253 55.4689 80.7919 59.0146C80.8158 59.1847 80.1961 75.0527 80.9131 80.1544C81.4269 83.8106 84.1831 91.7473 84.1951 91.8323C84.3276 92.1605 84.1213 92.5363 83.7945 92.669C83.6252 92.6928 83.5405 92.7047 83.5405 92.7047Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M27.146 40.3479C26.8073 40.3955 26.4327 40.188 26.373 39.7628L22.1068 9.40755C21.7961 7.19681 23.3116 5.07624 25.5981 4.75489L53.6286 0.815456C55.8304 0.506014 57.9444 2.02978 58.2671 4.32556L61.6609 28.4737C61.7087 28.8139 61.5024 29.1897 61.079 29.2492C60.6556 29.3087 60.3657 29.0893 60.3059 28.6642L56.9121 4.51599C56.697 2.98547 55.2475 1.88856 53.7232 2.10279L25.862 6.01842C24.3377 6.23265 23.2467 7.68661 23.4618 9.21713L27.7399 39.6574C27.7877 39.9976 27.4848 40.3003 27.146 40.3479Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M59.9591 67.4687L36.4893 70.7672C36.1645 70.8129 35.8038 70.6034 35.744 70.1783C35.6843 69.7531 35.8921 69.4638 36.2981 69.4067L59.7679 66.1083C60.0927 66.0626 60.4534 66.272 60.5132 66.6972C60.5729 67.1223 60.2839 67.4231 59.9591 67.4687Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M26.0581 32.6069C26.0581 32.6069 17.5491 29.2072 17.7745 24.6667C18 20.1262 24.5882 22.1483 24.5882 22.1483L26.0581 32.6069Z"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M26.1422 33.2036C26.0576 33.2155 25.8882 33.2393 25.7916 33.1662C25.4289 33.0437 16.8113 29.4859 17.0737 24.5934C17.1604 23.3672 17.6337 22.4337 18.4935 21.7926C20.6974 20.2689 24.5659 21.3727 24.7472 21.4339C25.0132 21.4832 25.1337 21.7264 25.1696 21.9815L26.6394 32.44C26.6753 32.6951 26.6145 32.8771 26.3724 32.9978C26.3963 33.1679 26.3116 33.1798 26.1422 33.2036ZM20.7301 22.3453C20.222 22.4167 19.6412 22.5851 19.2536 22.8997C18.7086 23.3231 18.4416 23.8809 18.3798 24.6699C18.266 27.5473 22.6156 30.2309 25.2138 31.5132L23.9591 22.5852C23.2457 22.4253 21.831 22.1906 20.7301 22.3453Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M30.6341 60.2323C30.6341 60.2323 28.2998 60.2135 26.8581 61.6301C25.4164 63.0466 24.5774 65.679 26.9792 68.6364C28.0292 69.9629 34.2756 73.854 35.8171 70.6892C37.504 67.3307 30.6539 62.8308 30.6539 62.8308L30.6341 60.2323Z"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M34.2511 72.4696L34.1664 72.4815C31.4446 72.7773 27.4457 70.1311 26.5043 68.9628C23.9819 65.7622 24.7731 62.7896 26.433 61.0823C28.0202 59.4719 30.5239 59.4669 30.6086 59.455C30.9592 59.4924 31.2491 59.7118 31.2123 60.0638L31.1842 62.3222C32.5252 63.2609 38.0214 67.3441 36.2617 70.7996C35.9817 71.8795 35.1827 72.3386 34.2511 72.4696ZM29.9529 60.9345C29.2754 61.0297 28.1018 61.2813 27.3506 62.0806C26.5993 62.8798 25.0111 65.0973 27.5215 68.2128C28.2577 69.1499 31.9548 71.4917 33.9872 71.206C34.58 71.1227 34.9795 70.8931 35.2585 70.4204C36.3994 68.0923 32.0997 64.5346 30.2995 63.4003C30.1062 63.2541 29.9976 63.0959 30.0464 62.8289L29.9529 60.9345Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M28.5598 50.38C28.5598 50.38 26.1408 50.3731 24.711 51.8747C23.1966 53.3881 22.7192 56.7501 24.4924 59.5357C25.4816 61.0442 32.26 65.0339 33.8383 61.5172C35.4167 58.0004 28.8346 52.3356 28.8346 52.3356L28.5598 50.38Z"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M32.0429 63.5032C31.9582 63.5151 31.8735 63.527 31.7889 63.5389C28.9704 63.7616 24.8141 61.2242 23.9334 59.8739C21.955 56.8571 22.554 53.1311 24.2139 51.4238C25.8738 49.7165 28.4741 49.7846 28.5588 49.7727C28.9095 49.8101 29.1147 50.0414 29.1505 50.2965L29.3776 51.912C30.5731 53.0446 35.9467 58.0989 34.2956 61.7126C34.0036 62.7074 33.1438 63.3485 32.0429 63.5032ZM27.8792 51.0821C27.1171 51.1892 25.9554 51.5259 25.2042 52.3251C23.9199 53.6328 23.4793 56.6429 25.0473 59.1972C25.6988 60.1461 29.3959 62.4879 31.7062 62.3366C32.4684 62.2295 33.0373 61.9761 33.2924 61.3333C34.3974 58.7502 30.2442 54.3915 28.4809 52.9051C28.3842 52.832 28.2757 52.6738 28.2518 52.5038L28.0725 51.2284C27.9639 51.0702 27.9639 51.0702 27.8792 51.0821Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M27.1369 40.2611C27.1369 40.2611 24.7179 40.2543 23.2882 41.7558C21.8584 43.2574 21.6829 46.9238 23.0695 49.4169C23.9013 51.0342 30.606 55.7279 32.3178 51.9323C34.1144 48.1248 27.4118 42.2168 27.4118 42.2168L27.1369 40.2611Z"\r\n                                        fill="white"></path>\r\n                                    <path\r\n                                        d="M30.5224 53.9177C30.353 53.9415 30.2683 53.9534 30.0989 53.9772C27.1719 54.0417 23.1979 50.9585 22.4986 49.6694C21.0033 47.0182 21.2158 42.9998 22.791 41.3043C24.4509 39.597 27.0512 39.6651 27.1359 39.6532C27.4866 39.6906 27.6918 39.9219 27.7277 40.177L27.9547 41.7925C29.0535 42.852 34.6443 48.2226 32.8597 52.1152C32.3984 53.1338 31.6233 53.763 30.5224 53.9177ZM26.4564 40.9626C25.6942 41.0697 24.5325 41.4064 23.7813 42.2057C22.497 43.5134 22.4549 46.9009 23.6244 49.0777C24.0946 49.9654 27.682 52.7561 30.0891 52.678C30.8632 52.6559 31.4201 52.3175 31.7479 51.5777C32.9984 48.8007 28.7247 44.1989 27.0341 42.6156C26.9375 42.5425 26.8289 42.3843 26.805 42.2143L26.6257 40.9388C26.541 40.9507 26.541 40.9507 26.4564 40.9626Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path fill-rule="evenodd" clip-rule="evenodd"\r\n                                        d="M37.3887 7.20464C37.3394 6.85895 37.5797 6.53875 37.9254 6.48946L42.8665 5.78504C43.2122 5.73575 43.5324 5.97604 43.5817 6.32174C43.6309 6.66744 43.3906 6.98764 43.045 7.03692L38.1039 7.74135C37.7582 7.79063 37.438 7.55034 37.3887 7.20464Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M36.7468 45.6408L35.5039 36.7969L38.9177 36.3171C39.8477 36.1864 40.5897 36.3166 41.1438 36.7078C41.706 37.0979 42.0471 37.7194 42.1669 38.5724C42.2856 39.4171 42.1291 40.1086 41.6973 40.6468C41.2725 41.1756 40.5952 41.5053 39.6653 41.636L37.2548 41.9748L37.7502 45.4998L36.7468 45.6408ZM37.1331 41.1092L39.4212 40.7876C40.759 40.5996 41.3439 39.9076 41.1758 38.7117C41.0066 37.5074 40.2531 36.9993 38.9153 37.1873L36.6271 37.5089L37.1331 41.1092Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M44.4899 44.5526L43.247 35.7087L44.2503 35.5676L45.4932 44.4116L44.4899 44.5526Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <path\r\n                                        d="M46.6784 44.245L49.3229 39.2681L45.5945 35.3787L46.7692 35.2136L49.801 38.4078L51.8104 34.5051L52.9973 34.3383L50.4731 39.1064L54.387 43.1616L53.2002 43.3284L50.0073 39.965L47.8775 44.0765L46.6784 44.245Z"\r\n                                        fill="#4A4A4A"></path>\r\n                                    <rect x="36.0215" y="54.873" width="23.7514" height="5.9539" rx="2.97695"\r\n                                        transform="rotate(-8 36.0215 54.873)" fill="#F28000"></rect>\r\n                                    <path\r\n                                        d="M90.5536 1.50586H68.0658C65.4404 1.50586 63.2715 3.56929 63.2715 6.06713V22.0316C63.2715 24.5294 65.4404 26.5928 68.0658 26.5928H71.1479C71.4904 26.5928 71.7187 26.81 71.7187 27.1358V33.1089C71.7187 33.6519 72.4036 33.8691 72.746 33.5433L79.8234 26.81C79.9375 26.7014 80.0517 26.7014 80.28 26.7014H90.6677C93.2932 26.7014 95.462 24.638 95.462 22.1402V6.06713C95.3479 3.56929 93.179 1.50586 90.5536 1.50586Z"\r\n                                        fill="#F28000"></path>\r\n                                    <path fill-rule="evenodd" clip-rule="evenodd"\r\n                                        d="M73.2439 8.18377C73.8476 7.56114 74.8266 7.56114 75.4303 8.18377L85.0503 18.104C85.6541 18.7266 85.6541 19.7361 85.0503 20.3587C84.4465 20.9814 83.4676 20.9814 82.8638 20.3587L73.2439 10.4385C72.6401 9.81588 72.6401 8.8064 73.2439 8.18377Z"\r\n                                        fill="white"></path>\r\n                                    <path fill-rule="evenodd" clip-rule="evenodd"\r\n                                        d="M73.6821 20.3594C73.0784 19.7367 73.0784 18.7272 73.6821 18.1046L83.3021 8.1844C83.9059 7.56177 84.8848 7.56177 85.4886 8.1844C86.0924 8.80702 86.0924 9.81651 85.4886 10.4391L75.8686 20.3594C75.2648 20.982 74.2859 20.982 73.6821 20.3594Z"\r\n                                        fill="white"></path>\r\n                                </g>\r\n                                <defs>\r\n                                    <clipPath id="olx-patch-expired-pix-clip">\r\n                                        <rect width="96" height="96" fill="white"></rect>\r\n                                    </clipPath>\r\n                                </defs>\r\n                            </svg>';

  // libs/qrcode.js
  var qrcode = (function() {
    var qrcode2 = function(typeNumber, errorCorrectionLevel) {
      var PAD0 = 236;
      var PAD1 = 17;
      var _typeNumber = typeNumber;
      var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
      var _modules = null;
      var _moduleCount = 0;
      var _dataCache = null;
      var _dataList = [];
      var _this = {};
      var makeImpl = function(test, maskPattern) {
        _moduleCount = _typeNumber * 4 + 17;
        _modules = (function(moduleCount) {
          var modules = new Array(moduleCount);
          for (var row = 0; row < moduleCount; row += 1) {
            modules[row] = new Array(moduleCount);
            for (var col = 0; col < moduleCount; col += 1) {
              modules[row][col] = null;
            }
          }
          return modules;
        })(_moduleCount);
        setupPositionProbePattern(0, 0);
        setupPositionProbePattern(_moduleCount - 7, 0);
        setupPositionProbePattern(0, _moduleCount - 7);
        setupPositionAdjustPattern();
        setupTimingPattern();
        setupTypeInfo(test, maskPattern);
        if (_typeNumber >= 7) {
          setupTypeNumber(test);
        }
        if (_dataCache == null) {
          _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
        }
        mapData(_dataCache, maskPattern);
      };
      var setupPositionProbePattern = function(row, col) {
        for (var r = -1; r <= 7; r += 1) {
          if (row + r <= -1 || _moduleCount <= row + r) continue;
          for (var c = -1; c <= 7; c += 1) {
            if (col + c <= -1 || _moduleCount <= col + c) continue;
            if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      };
      var getBestMaskPattern = function() {
        var minLostPoint = 0;
        var pattern = 0;
        for (var i = 0; i < 8; i += 1) {
          makeImpl(true, i);
          var lostPoint = QRUtil.getLostPoint(_this);
          if (i == 0 || minLostPoint > lostPoint) {
            minLostPoint = lostPoint;
            pattern = i;
          }
        }
        return pattern;
      };
      var setupTimingPattern = function() {
        for (var r = 8; r < _moduleCount - 8; r += 1) {
          if (_modules[r][6] != null) {
            continue;
          }
          _modules[r][6] = r % 2 == 0;
        }
        for (var c = 8; c < _moduleCount - 8; c += 1) {
          if (_modules[6][c] != null) {
            continue;
          }
          _modules[6][c] = c % 2 == 0;
        }
      };
      var setupPositionAdjustPattern = function() {
        var pos = QRUtil.getPatternPosition(_typeNumber);
        for (var i = 0; i < pos.length; i += 1) {
          for (var j = 0; j < pos.length; j += 1) {
            var row = pos[i];
            var col = pos[j];
            if (_modules[row][col] != null) {
              continue;
            }
            for (var r = -2; r <= 2; r += 1) {
              for (var c = -2; c <= 2; c += 1) {
                if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
                  _modules[row + r][col + c] = true;
                } else {
                  _modules[row + r][col + c] = false;
                }
              }
            }
          }
        }
      };
      var setupTypeNumber = function(test) {
        var bits = QRUtil.getBCHTypeNumber(_typeNumber);
        for (var i = 0; i < 18; i += 1) {
          var mod = !test && (bits >> i & 1) == 1;
          _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
        }
        for (var i = 0; i < 18; i += 1) {
          var mod = !test && (bits >> i & 1) == 1;
          _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
        }
      };
      var setupTypeInfo = function(test, maskPattern) {
        var data = _errorCorrectionLevel << 3 | maskPattern;
        var bits = QRUtil.getBCHTypeInfo(data);
        for (var i = 0; i < 15; i += 1) {
          var mod = !test && (bits >> i & 1) == 1;
          if (i < 6) {
            _modules[i][8] = mod;
          } else if (i < 8) {
            _modules[i + 1][8] = mod;
          } else {
            _modules[_moduleCount - 15 + i][8] = mod;
          }
        }
        for (var i = 0; i < 15; i += 1) {
          var mod = !test && (bits >> i & 1) == 1;
          if (i < 8) {
            _modules[8][_moduleCount - i - 1] = mod;
          } else if (i < 9) {
            _modules[8][15 - i - 1 + 1] = mod;
          } else {
            _modules[8][15 - i - 1] = mod;
          }
        }
        _modules[_moduleCount - 8][8] = !test;
      };
      var mapData = function(data, maskPattern) {
        var inc = -1;
        var row = _moduleCount - 1;
        var bitIndex = 7;
        var byteIndex = 0;
        var maskFunc = QRUtil.getMaskFunction(maskPattern);
        for (var col = _moduleCount - 1; col > 0; col -= 2) {
          if (col == 6) col -= 1;
          while (true) {
            for (var c = 0; c < 2; c += 1) {
              if (_modules[row][col - c] == null) {
                var dark = false;
                if (byteIndex < data.length) {
                  dark = (data[byteIndex] >>> bitIndex & 1) == 1;
                }
                var mask = maskFunc(row, col - c);
                if (mask) {
                  dark = !dark;
                }
                _modules[row][col - c] = dark;
                bitIndex -= 1;
                if (bitIndex == -1) {
                  byteIndex += 1;
                  bitIndex = 7;
                }
              }
            }
            row += inc;
            if (row < 0 || _moduleCount <= row) {
              row -= inc;
              inc = -inc;
              break;
            }
          }
        }
      };
      var createBytes = function(buffer, rsBlocks) {
        var offset = 0;
        var maxDcCount = 0;
        var maxEcCount = 0;
        var dcdata = new Array(rsBlocks.length);
        var ecdata = new Array(rsBlocks.length);
        for (var r = 0; r < rsBlocks.length; r += 1) {
          var dcCount = rsBlocks[r].dataCount;
          var ecCount = rsBlocks[r].totalCount - dcCount;
          maxDcCount = Math.max(maxDcCount, dcCount);
          maxEcCount = Math.max(maxEcCount, ecCount);
          dcdata[r] = new Array(dcCount);
          for (var i = 0; i < dcdata[r].length; i += 1) {
            dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
          }
          offset += dcCount;
          var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
          var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
          var modPoly = rawPoly.mod(rsPoly);
          ecdata[r] = new Array(rsPoly.getLength() - 1);
          for (var i = 0; i < ecdata[r].length; i += 1) {
            var modIndex = i + modPoly.getLength() - ecdata[r].length;
            ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
          }
        }
        var totalCodeCount = 0;
        for (var i = 0; i < rsBlocks.length; i += 1) {
          totalCodeCount += rsBlocks[i].totalCount;
        }
        var data = new Array(totalCodeCount);
        var index = 0;
        for (var i = 0; i < maxDcCount; i += 1) {
          for (var r = 0; r < rsBlocks.length; r += 1) {
            if (i < dcdata[r].length) {
              data[index] = dcdata[r][i];
              index += 1;
            }
          }
        }
        for (var i = 0; i < maxEcCount; i += 1) {
          for (var r = 0; r < rsBlocks.length; r += 1) {
            if (i < ecdata[r].length) {
              data[index] = ecdata[r][i];
              index += 1;
            }
          }
        }
        return data;
      };
      var createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
        var rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
        var buffer = qrBitBuffer();
        for (var i = 0; i < dataList.length; i += 1) {
          var data = dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        var totalDataCount = 0;
        for (var i = 0; i < rsBlocks.length; i += 1) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() > totalDataCount * 8) {
          throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
        }
        if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
          buffer.put(0, 4);
        }
        while (buffer.getLengthInBits() % 8 != 0) {
          buffer.putBit(false);
        }
        while (true) {
          if (buffer.getLengthInBits() >= totalDataCount * 8) {
            break;
          }
          buffer.put(PAD0, 8);
          if (buffer.getLengthInBits() >= totalDataCount * 8) {
            break;
          }
          buffer.put(PAD1, 8);
        }
        return createBytes(buffer, rsBlocks);
      };
      _this.addData = function(data, mode) {
        mode = mode || "Byte";
        var newData = null;
        switch (mode) {
          case "Numeric":
            newData = qrNumber(data);
            break;
          case "Alphanumeric":
            newData = qrAlphaNum(data);
            break;
          case "Byte":
            newData = qr8BitByte(data);
            break;
          case "Kanji":
            newData = qrKanji(data);
            break;
          default:
            throw "mode:" + mode;
        }
        _dataList.push(newData);
        _dataCache = null;
      };
      _this.isDark = function(row, col) {
        if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
          throw row + "," + col;
        }
        return _modules[row][col];
      };
      _this.getModuleCount = function() {
        return _moduleCount;
      };
      _this.make = function() {
        if (_typeNumber < 1) {
          var typeNumber2 = 1;
          for (; typeNumber2 < 40; typeNumber2++) {
            var rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
            var buffer = qrBitBuffer();
            for (var i = 0; i < _dataList.length; i++) {
              var data = _dataList[i];
              buffer.put(data.getMode(), 4);
              buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
              data.write(buffer);
            }
            var totalDataCount = 0;
            for (var i = 0; i < rsBlocks.length; i++) {
              totalDataCount += rsBlocks[i].dataCount;
            }
            if (buffer.getLengthInBits() <= totalDataCount * 8) {
              break;
            }
          }
          _typeNumber = typeNumber2;
        }
        makeImpl(false, getBestMaskPattern());
      };
      _this.createTableTag = function(cellSize, margin) {
        cellSize = cellSize || 2;
        margin = typeof margin == "undefined" ? cellSize * 4 : margin;
        var qrHtml = "";
        qrHtml += '<table style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: " + margin + "px;";
        qrHtml += '">';
        qrHtml += "<tbody>";
        for (var r = 0; r < _this.getModuleCount(); r += 1) {
          qrHtml += "<tr>";
          for (var c = 0; c < _this.getModuleCount(); c += 1) {
            qrHtml += '<td style="';
            qrHtml += " border-width: 0px; border-style: none;";
            qrHtml += " border-collapse: collapse;";
            qrHtml += " padding: 0px; margin: 0px;";
            qrHtml += " width: " + cellSize + "px;";
            qrHtml += " height: " + cellSize + "px;";
            qrHtml += " background-color: ";
            qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
            qrHtml += ";";
            qrHtml += '"/>';
          }
          qrHtml += "</tr>";
        }
        qrHtml += "</tbody>";
        qrHtml += "</table>";
        return qrHtml;
      };
      _this.createSvgTag = function(cellSize, margin, alt, title) {
        var opts = {};
        if (typeof arguments[0] == "object") {
          opts = arguments[0];
          cellSize = opts.cellSize;
          margin = opts.margin;
          alt = opts.alt;
          title = opts.title;
        }
        cellSize = cellSize || 2;
        margin = typeof margin == "undefined" ? cellSize * 4 : margin;
        alt = typeof alt === "string" ? { text: alt } : alt || {};
        alt.text = alt.text || null;
        alt.id = alt.text ? alt.id || "qrcode-description" : null;
        title = typeof title === "string" ? { text: title } : title || {};
        title.text = title.text || null;
        title.id = title.text ? title.id || "qrcode-title" : null;
        var size = _this.getModuleCount() * cellSize + margin * 2;
        var c, mc, r, mr, qrSvg = "", rect;
        rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
        qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
        qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
        qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
        qrSvg += ' preserveAspectRatio="xMinYMin meet"';
        qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
        qrSvg += ">";
        qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
        qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
        qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
        qrSvg += '<path d="';
        for (r = 0; r < _this.getModuleCount(); r += 1) {
          mr = r * cellSize + margin;
          for (c = 0; c < _this.getModuleCount(); c += 1) {
            if (_this.isDark(r, c)) {
              mc = c * cellSize + margin;
              qrSvg += "M" + mc + "," + mr + rect;
            }
          }
        }
        qrSvg += '" stroke="transparent" fill="black"/>';
        qrSvg += "</svg>";
        return qrSvg;
      };
      _this.createDataURL = function(cellSize, margin) {
        cellSize = cellSize || 2;
        margin = typeof margin == "undefined" ? cellSize * 4 : margin;
        var size = _this.getModuleCount() * cellSize + margin * 2;
        var min = margin;
        var max = size - margin;
        return createDataURL(size, size, function(x, y) {
          if (min <= x && x < max && min <= y && y < max) {
            var c = Math.floor((x - min) / cellSize);
            var r = Math.floor((y - min) / cellSize);
            return _this.isDark(r, c) ? 0 : 1;
          } else {
            return 1;
          }
        });
      };
      _this.createImgTag = function(cellSize, margin, alt) {
        cellSize = cellSize || 2;
        margin = typeof margin == "undefined" ? cellSize * 4 : margin;
        var size = _this.getModuleCount() * cellSize + margin * 2;
        var img = "";
        img += "<img";
        img += ' src="';
        img += _this.createDataURL(cellSize, margin);
        img += '"';
        img += ' width="';
        img += size;
        img += '"';
        img += ' height="';
        img += size;
        img += '"';
        if (alt) {
          img += ' alt="';
          img += escapeXml(alt);
          img += '"';
        }
        img += "/>";
        return img;
      };
      var escapeXml = function(s) {
        var escaped = "";
        for (var i = 0; i < s.length; i += 1) {
          var c = s.charAt(i);
          switch (c) {
            case "<":
              escaped += "&lt;";
              break;
            case ">":
              escaped += "&gt;";
              break;
            case "&":
              escaped += "&amp;";
              break;
            case '"':
              escaped += "&quot;";
              break;
            default:
              escaped += c;
              break;
          }
        }
        return escaped;
      };
      var _createHalfASCII = function(margin) {
        var cellSize = 1;
        margin = typeof margin == "undefined" ? cellSize * 2 : margin;
        var size = _this.getModuleCount() * cellSize + margin * 2;
        var min = margin;
        var max = size - margin;
        var y, x, r1, r2, p;
        var blocks = {
          "\u2588\u2588": "\u2588",
          "\u2588 ": "\u2580",
          " \u2588": "\u2584",
          "  ": " "
        };
        var blocksLastLineNoMargin = {
          "\u2588\u2588": "\u2580",
          "\u2588 ": "\u2580",
          " \u2588": " ",
          "  ": " "
        };
        var ascii = "";
        for (y = 0; y < size; y += 2) {
          r1 = Math.floor((y - min) / cellSize);
          r2 = Math.floor((y + 1 - min) / cellSize);
          for (x = 0; x < size; x += 1) {
            p = "\u2588";
            if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
              p = " ";
            }
            if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
              p += " ";
            } else {
              p += "\u2588";
            }
            ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
          }
          ascii += "\n";
        }
        if (size % 2 && margin > 0) {
          return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
        }
        return ascii.substring(0, ascii.length - 1);
      };
      _this.createASCII = function(cellSize, margin) {
        cellSize = cellSize || 1;
        if (cellSize < 2) {
          return _createHalfASCII(margin);
        }
        cellSize -= 1;
        margin = typeof margin == "undefined" ? cellSize * 2 : margin;
        var size = _this.getModuleCount() * cellSize + margin * 2;
        var min = margin;
        var max = size - margin;
        var y, x, r, p;
        var white = Array(cellSize + 1).join("\u2588\u2588");
        var black = Array(cellSize + 1).join("  ");
        var ascii = "";
        var line = "";
        for (y = 0; y < size; y += 1) {
          r = Math.floor((y - min) / cellSize);
          line = "";
          for (x = 0; x < size; x += 1) {
            p = 1;
            if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
              p = 0;
            }
            line += p ? white : black;
          }
          for (r = 0; r < cellSize; r += 1) {
            ascii += line + "\n";
          }
        }
        return ascii.substring(0, ascii.length - 1);
      };
      _this.renderTo2dContext = function(context, cellSize) {
        cellSize = cellSize || 2;
        var length = _this.getModuleCount();
        for (var row = 0; row < length; row++) {
          for (var col = 0; col < length; col++) {
            context.fillStyle = _this.isDark(row, col) ? "black" : "white";
            context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      };
      return _this;
    };
    qrcode2.stringToBytesFuncs = {
      "default": function(s) {
        var bytes = [];
        for (var i = 0; i < s.length; i += 1) {
          var c = s.charCodeAt(i);
          bytes.push(c & 255);
        }
        return bytes;
      }
    };
    qrcode2.stringToBytes = qrcode2.stringToBytesFuncs["default"];
    qrcode2.createStringToBytes = function(unicodeData, numChars) {
      var unicodeMap = (function() {
        var bin = base64DecodeInputStream(unicodeData);
        var read = function() {
          var b = bin.read();
          if (b == -1) throw "eof";
          return b;
        };
        var count = 0;
        var unicodeMap2 = {};
        while (true) {
          var b0 = bin.read();
          if (b0 == -1) break;
          var b1 = read();
          var b2 = read();
          var b3 = read();
          var k = String.fromCharCode(b0 << 8 | b1);
          var v = b2 << 8 | b3;
          unicodeMap2[k] = v;
          count += 1;
        }
        if (count != numChars) {
          throw count + " != " + numChars;
        }
        return unicodeMap2;
      })();
      var unknownChar = "?".charCodeAt(0);
      return function(s) {
        var bytes = [];
        for (var i = 0; i < s.length; i += 1) {
          var c = s.charCodeAt(i);
          if (c < 128) {
            bytes.push(c);
          } else {
            var b = unicodeMap[s.charAt(i)];
            if (typeof b == "number") {
              if ((b & 255) == b) {
                bytes.push(b);
              } else {
                bytes.push(b >>> 8);
                bytes.push(b & 255);
              }
            } else {
              bytes.push(unknownChar);
            }
          }
        }
        return bytes;
      };
    };
    var QRMode = {
      MODE_NUMBER: 1 << 0,
      MODE_ALPHA_NUM: 1 << 1,
      MODE_8BIT_BYTE: 1 << 2,
      MODE_KANJI: 1 << 3
    };
    var QRErrorCorrectionLevel = {
      L: 1,
      M: 0,
      Q: 3,
      H: 2
    };
    var QRMaskPattern = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var QRUtil = (function() {
      var PATTERN_POSITION_TABLE = [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
      ];
      var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
      var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
      var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
      var _this = {};
      var getBCHDigit = function(data) {
        var digit = 0;
        while (data != 0) {
          digit += 1;
          data >>>= 1;
        }
        return digit;
      };
      _this.getBCHTypeInfo = function(data) {
        var d = data << 10;
        while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
          d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
        }
        return (data << 10 | d) ^ G15_MASK;
      };
      _this.getBCHTypeNumber = function(data) {
        var d = data << 12;
        while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
          d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
        }
        return data << 12 | d;
      };
      _this.getPatternPosition = function(typeNumber) {
        return PATTERN_POSITION_TABLE[typeNumber - 1];
      };
      _this.getMaskFunction = function(maskPattern) {
        switch (maskPattern) {
          case QRMaskPattern.PATTERN000:
            return function(i, j) {
              return (i + j) % 2 == 0;
            };
          case QRMaskPattern.PATTERN001:
            return function(i, j) {
              return i % 2 == 0;
            };
          case QRMaskPattern.PATTERN010:
            return function(i, j) {
              return j % 3 == 0;
            };
          case QRMaskPattern.PATTERN011:
            return function(i, j) {
              return (i + j) % 3 == 0;
            };
          case QRMaskPattern.PATTERN100:
            return function(i, j) {
              return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
            };
          case QRMaskPattern.PATTERN101:
            return function(i, j) {
              return i * j % 2 + i * j % 3 == 0;
            };
          case QRMaskPattern.PATTERN110:
            return function(i, j) {
              return (i * j % 2 + i * j % 3) % 2 == 0;
            };
          case QRMaskPattern.PATTERN111:
            return function(i, j) {
              return (i * j % 3 + (i + j) % 2) % 2 == 0;
            };
          default:
            throw "bad maskPattern:" + maskPattern;
        }
      };
      _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
        var a = qrPolynomial([1], 0);
        for (var i = 0; i < errorCorrectLength; i += 1) {
          a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
        }
        return a;
      };
      _this.getLengthInBits = function(mode, type) {
        if (1 <= type && type < 10) {
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 10;
            case QRMode.MODE_ALPHA_NUM:
              return 9;
            case QRMode.MODE_8BIT_BYTE:
              return 8;
            case QRMode.MODE_KANJI:
              return 8;
            default:
              throw "mode:" + mode;
          }
        } else if (type < 27) {
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 12;
            case QRMode.MODE_ALPHA_NUM:
              return 11;
            case QRMode.MODE_8BIT_BYTE:
              return 16;
            case QRMode.MODE_KANJI:
              return 10;
            default:
              throw "mode:" + mode;
          }
        } else if (type < 41) {
          switch (mode) {
            case QRMode.MODE_NUMBER:
              return 14;
            case QRMode.MODE_ALPHA_NUM:
              return 13;
            case QRMode.MODE_8BIT_BYTE:
              return 16;
            case QRMode.MODE_KANJI:
              return 12;
            default:
              throw "mode:" + mode;
          }
        } else {
          throw "type:" + type;
        }
      };
      _this.getLostPoint = function(qrcode3) {
        var moduleCount = qrcode3.getModuleCount();
        var lostPoint = 0;
        for (var row = 0; row < moduleCount; row += 1) {
          for (var col = 0; col < moduleCount; col += 1) {
            var sameCount = 0;
            var dark = qrcode3.isDark(row, col);
            for (var r = -1; r <= 1; r += 1) {
              if (row + r < 0 || moduleCount <= row + r) {
                continue;
              }
              for (var c = -1; c <= 1; c += 1) {
                if (col + c < 0 || moduleCount <= col + c) {
                  continue;
                }
                if (r == 0 && c == 0) {
                  continue;
                }
                if (dark == qrcode3.isDark(row + r, col + c)) {
                  sameCount += 1;
                }
              }
            }
            if (sameCount > 5) {
              lostPoint += 3 + sameCount - 5;
            }
          }
        }
        ;
        for (var row = 0; row < moduleCount - 1; row += 1) {
          for (var col = 0; col < moduleCount - 1; col += 1) {
            var count = 0;
            if (qrcode3.isDark(row, col)) count += 1;
            if (qrcode3.isDark(row + 1, col)) count += 1;
            if (qrcode3.isDark(row, col + 1)) count += 1;
            if (qrcode3.isDark(row + 1, col + 1)) count += 1;
            if (count == 0 || count == 4) {
              lostPoint += 3;
            }
          }
        }
        for (var row = 0; row < moduleCount; row += 1) {
          for (var col = 0; col < moduleCount - 6; col += 1) {
            if (qrcode3.isDark(row, col) && !qrcode3.isDark(row, col + 1) && qrcode3.isDark(row, col + 2) && qrcode3.isDark(row, col + 3) && qrcode3.isDark(row, col + 4) && !qrcode3.isDark(row, col + 5) && qrcode3.isDark(row, col + 6)) {
              lostPoint += 40;
            }
          }
        }
        for (var col = 0; col < moduleCount; col += 1) {
          for (var row = 0; row < moduleCount - 6; row += 1) {
            if (qrcode3.isDark(row, col) && !qrcode3.isDark(row + 1, col) && qrcode3.isDark(row + 2, col) && qrcode3.isDark(row + 3, col) && qrcode3.isDark(row + 4, col) && !qrcode3.isDark(row + 5, col) && qrcode3.isDark(row + 6, col)) {
              lostPoint += 40;
            }
          }
        }
        var darkCount = 0;
        for (var col = 0; col < moduleCount; col += 1) {
          for (var row = 0; row < moduleCount; row += 1) {
            if (qrcode3.isDark(row, col)) {
              darkCount += 1;
            }
          }
        }
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;
        return lostPoint;
      };
      return _this;
    })();
    var QRMath = (function() {
      var EXP_TABLE = new Array(256);
      var LOG_TABLE = new Array(256);
      for (var i = 0; i < 8; i += 1) {
        EXP_TABLE[i] = 1 << i;
      }
      for (var i = 8; i < 256; i += 1) {
        EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
      }
      for (var i = 0; i < 255; i += 1) {
        LOG_TABLE[EXP_TABLE[i]] = i;
      }
      var _this = {};
      _this.glog = function(n) {
        if (n < 1) {
          throw "glog(" + n + ")";
        }
        return LOG_TABLE[n];
      };
      _this.gexp = function(n) {
        while (n < 0) {
          n += 255;
        }
        while (n >= 256) {
          n -= 255;
        }
        return EXP_TABLE[n];
      };
      return _this;
    })();
    function qrPolynomial(num, shift) {
      if (typeof num.length == "undefined") {
        throw num.length + "/" + shift;
      }
      var _num = (function() {
        var offset = 0;
        while (offset < num.length && num[offset] == 0) {
          offset += 1;
        }
        var _num2 = new Array(num.length - offset + shift);
        for (var i = 0; i < num.length - offset; i += 1) {
          _num2[i] = num[i + offset];
        }
        return _num2;
      })();
      var _this = {};
      _this.getAt = function(index) {
        return _num[index];
      };
      _this.getLength = function() {
        return _num.length;
      };
      _this.multiply = function(e) {
        var num2 = new Array(_this.getLength() + e.getLength() - 1);
        for (var i = 0; i < _this.getLength(); i += 1) {
          for (var j = 0; j < e.getLength(); j += 1) {
            num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
          }
        }
        return qrPolynomial(num2, 0);
      };
      _this.mod = function(e) {
        if (_this.getLength() - e.getLength() < 0) {
          return _this;
        }
        var ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
        var num2 = new Array(_this.getLength());
        for (var i = 0; i < _this.getLength(); i += 1) {
          num2[i] = _this.getAt(i);
        }
        for (var i = 0; i < e.getLength(); i += 1) {
          num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
        }
        return qrPolynomial(num2, 0).mod(e);
      };
      return _this;
    }
    ;
    var QRRSBlock = (function() {
      var RS_BLOCK_TABLE = [
        // L
        // M
        // Q
        // H
        // 1
        [1, 26, 19],
        [1, 26, 16],
        [1, 26, 13],
        [1, 26, 9],
        // 2
        [1, 44, 34],
        [1, 44, 28],
        [1, 44, 22],
        [1, 44, 16],
        // 3
        [1, 70, 55],
        [1, 70, 44],
        [2, 35, 17],
        [2, 35, 13],
        // 4
        [1, 100, 80],
        [2, 50, 32],
        [2, 50, 24],
        [4, 25, 9],
        // 5
        [1, 134, 108],
        [2, 67, 43],
        [2, 33, 15, 2, 34, 16],
        [2, 33, 11, 2, 34, 12],
        // 6
        [2, 86, 68],
        [4, 43, 27],
        [4, 43, 19],
        [4, 43, 15],
        // 7
        [2, 98, 78],
        [4, 49, 31],
        [2, 32, 14, 4, 33, 15],
        [4, 39, 13, 1, 40, 14],
        // 8
        [2, 121, 97],
        [2, 60, 38, 2, 61, 39],
        [4, 40, 18, 2, 41, 19],
        [4, 40, 14, 2, 41, 15],
        // 9
        [2, 146, 116],
        [3, 58, 36, 2, 59, 37],
        [4, 36, 16, 4, 37, 17],
        [4, 36, 12, 4, 37, 13],
        // 10
        [2, 86, 68, 2, 87, 69],
        [4, 69, 43, 1, 70, 44],
        [6, 43, 19, 2, 44, 20],
        [6, 43, 15, 2, 44, 16],
        // 11
        [4, 101, 81],
        [1, 80, 50, 4, 81, 51],
        [4, 50, 22, 4, 51, 23],
        [3, 36, 12, 8, 37, 13],
        // 12
        [2, 116, 92, 2, 117, 93],
        [6, 58, 36, 2, 59, 37],
        [4, 46, 20, 6, 47, 21],
        [7, 42, 14, 4, 43, 15],
        // 13
        [4, 133, 107],
        [8, 59, 37, 1, 60, 38],
        [8, 44, 20, 4, 45, 21],
        [12, 33, 11, 4, 34, 12],
        // 14
        [3, 145, 115, 1, 146, 116],
        [4, 64, 40, 5, 65, 41],
        [11, 36, 16, 5, 37, 17],
        [11, 36, 12, 5, 37, 13],
        // 15
        [5, 109, 87, 1, 110, 88],
        [5, 65, 41, 5, 66, 42],
        [5, 54, 24, 7, 55, 25],
        [11, 36, 12, 7, 37, 13],
        // 16
        [5, 122, 98, 1, 123, 99],
        [7, 73, 45, 3, 74, 46],
        [15, 43, 19, 2, 44, 20],
        [3, 45, 15, 13, 46, 16],
        // 17
        [1, 135, 107, 5, 136, 108],
        [10, 74, 46, 1, 75, 47],
        [1, 50, 22, 15, 51, 23],
        [2, 42, 14, 17, 43, 15],
        // 18
        [5, 150, 120, 1, 151, 121],
        [9, 69, 43, 4, 70, 44],
        [17, 50, 22, 1, 51, 23],
        [2, 42, 14, 19, 43, 15],
        // 19
        [3, 141, 113, 4, 142, 114],
        [3, 70, 44, 11, 71, 45],
        [17, 47, 21, 4, 48, 22],
        [9, 39, 13, 16, 40, 14],
        // 20
        [3, 135, 107, 5, 136, 108],
        [3, 67, 41, 13, 68, 42],
        [15, 54, 24, 5, 55, 25],
        [15, 43, 15, 10, 44, 16],
        // 21
        [4, 144, 116, 4, 145, 117],
        [17, 68, 42],
        [17, 50, 22, 6, 51, 23],
        [19, 46, 16, 6, 47, 17],
        // 22
        [2, 139, 111, 7, 140, 112],
        [17, 74, 46],
        [7, 54, 24, 16, 55, 25],
        [34, 37, 13],
        // 23
        [4, 151, 121, 5, 152, 122],
        [4, 75, 47, 14, 76, 48],
        [11, 54, 24, 14, 55, 25],
        [16, 45, 15, 14, 46, 16],
        // 24
        [6, 147, 117, 4, 148, 118],
        [6, 73, 45, 14, 74, 46],
        [11, 54, 24, 16, 55, 25],
        [30, 46, 16, 2, 47, 17],
        // 25
        [8, 132, 106, 4, 133, 107],
        [8, 75, 47, 13, 76, 48],
        [7, 54, 24, 22, 55, 25],
        [22, 45, 15, 13, 46, 16],
        // 26
        [10, 142, 114, 2, 143, 115],
        [19, 74, 46, 4, 75, 47],
        [28, 50, 22, 6, 51, 23],
        [33, 46, 16, 4, 47, 17],
        // 27
        [8, 152, 122, 4, 153, 123],
        [22, 73, 45, 3, 74, 46],
        [8, 53, 23, 26, 54, 24],
        [12, 45, 15, 28, 46, 16],
        // 28
        [3, 147, 117, 10, 148, 118],
        [3, 73, 45, 23, 74, 46],
        [4, 54, 24, 31, 55, 25],
        [11, 45, 15, 31, 46, 16],
        // 29
        [7, 146, 116, 7, 147, 117],
        [21, 73, 45, 7, 74, 46],
        [1, 53, 23, 37, 54, 24],
        [19, 45, 15, 26, 46, 16],
        // 30
        [5, 145, 115, 10, 146, 116],
        [19, 75, 47, 10, 76, 48],
        [15, 54, 24, 25, 55, 25],
        [23, 45, 15, 25, 46, 16],
        // 31
        [13, 145, 115, 3, 146, 116],
        [2, 74, 46, 29, 75, 47],
        [42, 54, 24, 1, 55, 25],
        [23, 45, 15, 28, 46, 16],
        // 32
        [17, 145, 115],
        [10, 74, 46, 23, 75, 47],
        [10, 54, 24, 35, 55, 25],
        [19, 45, 15, 35, 46, 16],
        // 33
        [17, 145, 115, 1, 146, 116],
        [14, 74, 46, 21, 75, 47],
        [29, 54, 24, 19, 55, 25],
        [11, 45, 15, 46, 46, 16],
        // 34
        [13, 145, 115, 6, 146, 116],
        [14, 74, 46, 23, 75, 47],
        [44, 54, 24, 7, 55, 25],
        [59, 46, 16, 1, 47, 17],
        // 35
        [12, 151, 121, 7, 152, 122],
        [12, 75, 47, 26, 76, 48],
        [39, 54, 24, 14, 55, 25],
        [22, 45, 15, 41, 46, 16],
        // 36
        [6, 151, 121, 14, 152, 122],
        [6, 75, 47, 34, 76, 48],
        [46, 54, 24, 10, 55, 25],
        [2, 45, 15, 64, 46, 16],
        // 37
        [17, 152, 122, 4, 153, 123],
        [29, 74, 46, 14, 75, 47],
        [49, 54, 24, 10, 55, 25],
        [24, 45, 15, 46, 46, 16],
        // 38
        [4, 152, 122, 18, 153, 123],
        [13, 74, 46, 32, 75, 47],
        [48, 54, 24, 14, 55, 25],
        [42, 45, 15, 32, 46, 16],
        // 39
        [20, 147, 117, 4, 148, 118],
        [40, 75, 47, 7, 76, 48],
        [43, 54, 24, 22, 55, 25],
        [10, 45, 15, 67, 46, 16],
        // 40
        [19, 148, 118, 6, 149, 119],
        [18, 75, 47, 31, 76, 48],
        [34, 54, 24, 34, 55, 25],
        [20, 45, 15, 61, 46, 16]
      ];
      var qrRSBlock = function(totalCount, dataCount) {
        var _this2 = {};
        _this2.totalCount = totalCount;
        _this2.dataCount = dataCount;
        return _this2;
      };
      var _this = {};
      var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
        switch (errorCorrectionLevel) {
          case QRErrorCorrectionLevel.L:
            return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
          case QRErrorCorrectionLevel.M:
            return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
          case QRErrorCorrectionLevel.Q:
            return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
          case QRErrorCorrectionLevel.H:
            return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
          default:
            return void 0;
        }
      };
      _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
        var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
        if (typeof rsBlock == "undefined") {
          throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
        }
        var length = rsBlock.length / 3;
        var list = [];
        for (var i = 0; i < length; i += 1) {
          var count = rsBlock[i * 3 + 0];
          var totalCount = rsBlock[i * 3 + 1];
          var dataCount = rsBlock[i * 3 + 2];
          for (var j = 0; j < count; j += 1) {
            list.push(qrRSBlock(totalCount, dataCount));
          }
        }
        return list;
      };
      return _this;
    })();
    var qrBitBuffer = function() {
      var _buffer = [];
      var _length = 0;
      var _this = {};
      _this.getBuffer = function() {
        return _buffer;
      };
      _this.getAt = function(index) {
        var bufIndex = Math.floor(index / 8);
        return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
      };
      _this.put = function(num, length) {
        for (var i = 0; i < length; i += 1) {
          _this.putBit((num >>> length - i - 1 & 1) == 1);
        }
      };
      _this.getLengthInBits = function() {
        return _length;
      };
      _this.putBit = function(bit) {
        var bufIndex = Math.floor(_length / 8);
        if (_buffer.length <= bufIndex) {
          _buffer.push(0);
        }
        if (bit) {
          _buffer[bufIndex] |= 128 >>> _length % 8;
        }
        _length += 1;
      };
      return _this;
    };
    var qrNumber = function(data) {
      var _mode = QRMode.MODE_NUMBER;
      var _data = data;
      var _this = {};
      _this.getMode = function() {
        return _mode;
      };
      _this.getLength = function(buffer) {
        return _data.length;
      };
      _this.write = function(buffer) {
        var data2 = _data;
        var i = 0;
        while (i + 2 < data2.length) {
          buffer.put(strToNum(data2.substring(i, i + 3)), 10);
          i += 3;
        }
        if (i < data2.length) {
          if (data2.length - i == 1) {
            buffer.put(strToNum(data2.substring(i, i + 1)), 4);
          } else if (data2.length - i == 2) {
            buffer.put(strToNum(data2.substring(i, i + 2)), 7);
          }
        }
      };
      var strToNum = function(s) {
        var num = 0;
        for (var i = 0; i < s.length; i += 1) {
          num = num * 10 + chatToNum(s.charAt(i));
        }
        return num;
      };
      var chatToNum = function(c) {
        if ("0" <= c && c <= "9") {
          return c.charCodeAt(0) - "0".charCodeAt(0);
        }
        throw "illegal char :" + c;
      };
      return _this;
    };
    var qrAlphaNum = function(data) {
      var _mode = QRMode.MODE_ALPHA_NUM;
      var _data = data;
      var _this = {};
      _this.getMode = function() {
        return _mode;
      };
      _this.getLength = function(buffer) {
        return _data.length;
      };
      _this.write = function(buffer) {
        var s = _data;
        var i = 0;
        while (i + 1 < s.length) {
          buffer.put(
            getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
            11
          );
          i += 2;
        }
        if (i < s.length) {
          buffer.put(getCode(s.charAt(i)), 6);
        }
      };
      var getCode = function(c) {
        if ("0" <= c && c <= "9") {
          return c.charCodeAt(0) - "0".charCodeAt(0);
        } else if ("A" <= c && c <= "Z") {
          return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
        } else {
          switch (c) {
            case " ":
              return 36;
            case "$":
              return 37;
            case "%":
              return 38;
            case "*":
              return 39;
            case "+":
              return 40;
            case "-":
              return 41;
            case ".":
              return 42;
            case "/":
              return 43;
            case ":":
              return 44;
            default:
              throw "illegal char :" + c;
          }
        }
      };
      return _this;
    };
    var qr8BitByte = function(data) {
      var _mode = QRMode.MODE_8BIT_BYTE;
      var _data = data;
      var _bytes = qrcode2.stringToBytes(data);
      var _this = {};
      _this.getMode = function() {
        return _mode;
      };
      _this.getLength = function(buffer) {
        return _bytes.length;
      };
      _this.write = function(buffer) {
        for (var i = 0; i < _bytes.length; i += 1) {
          buffer.put(_bytes[i], 8);
        }
      };
      return _this;
    };
    var qrKanji = function(data) {
      var _mode = QRMode.MODE_KANJI;
      var _data = data;
      var stringToBytes = qrcode2.stringToBytesFuncs["SJIS"];
      if (!stringToBytes) {
        throw "sjis not supported.";
      }
      !(function(c, code) {
        var test = stringToBytes(c);
        if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
          throw "sjis not supported.";
        }
      })("\u53CB", 38726);
      var _bytes = stringToBytes(data);
      var _this = {};
      _this.getMode = function() {
        return _mode;
      };
      _this.getLength = function(buffer) {
        return ~~(_bytes.length / 2);
      };
      _this.write = function(buffer) {
        var data2 = _bytes;
        var i = 0;
        while (i + 1 < data2.length) {
          var c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
          if (33088 <= c && c <= 40956) {
            c -= 33088;
          } else if (57408 <= c && c <= 60351) {
            c -= 49472;
          } else {
            throw "illegal char at " + (i + 1) + "/" + c;
          }
          c = (c >>> 8 & 255) * 192 + (c & 255);
          buffer.put(c, 13);
          i += 2;
        }
        if (i < data2.length) {
          throw "illegal char at " + (i + 1);
        }
      };
      return _this;
    };
    var byteArrayOutputStream = function() {
      var _bytes = [];
      var _this = {};
      _this.writeByte = function(b) {
        _bytes.push(b & 255);
      };
      _this.writeShort = function(i) {
        _this.writeByte(i);
        _this.writeByte(i >>> 8);
      };
      _this.writeBytes = function(b, off, len) {
        off = off || 0;
        len = len || b.length;
        for (var i = 0; i < len; i += 1) {
          _this.writeByte(b[i + off]);
        }
      };
      _this.writeString = function(s) {
        for (var i = 0; i < s.length; i += 1) {
          _this.writeByte(s.charCodeAt(i));
        }
      };
      _this.toByteArray = function() {
        return _bytes;
      };
      _this.toString = function() {
        var s = "";
        s += "[";
        for (var i = 0; i < _bytes.length; i += 1) {
          if (i > 0) {
            s += ",";
          }
          s += _bytes[i];
        }
        s += "]";
        return s;
      };
      return _this;
    };
    var base64EncodeOutputStream = function() {
      var _buffer = 0;
      var _buflen = 0;
      var _length = 0;
      var _base64 = "";
      var _this = {};
      var writeEncoded = function(b) {
        _base64 += String.fromCharCode(encode(b & 63));
      };
      var encode = function(n) {
        if (n < 0) {
        } else if (n < 26) {
          return 65 + n;
        } else if (n < 52) {
          return 97 + (n - 26);
        } else if (n < 62) {
          return 48 + (n - 52);
        } else if (n == 62) {
          return 43;
        } else if (n == 63) {
          return 47;
        }
        throw "n:" + n;
      };
      _this.writeByte = function(n) {
        _buffer = _buffer << 8 | n & 255;
        _buflen += 8;
        _length += 1;
        while (_buflen >= 6) {
          writeEncoded(_buffer >>> _buflen - 6);
          _buflen -= 6;
        }
      };
      _this.flush = function() {
        if (_buflen > 0) {
          writeEncoded(_buffer << 6 - _buflen);
          _buffer = 0;
          _buflen = 0;
        }
        if (_length % 3 != 0) {
          var padlen = 3 - _length % 3;
          for (var i = 0; i < padlen; i += 1) {
            _base64 += "=";
          }
        }
      };
      _this.toString = function() {
        return _base64;
      };
      return _this;
    };
    var base64DecodeInputStream = function(str) {
      var _str = str;
      var _pos = 0;
      var _buffer = 0;
      var _buflen = 0;
      var _this = {};
      _this.read = function() {
        while (_buflen < 8) {
          if (_pos >= _str.length) {
            if (_buflen == 0) {
              return -1;
            }
            throw "unexpected end of file./" + _buflen;
          }
          var c = _str.charAt(_pos);
          _pos += 1;
          if (c == "=") {
            _buflen = 0;
            return -1;
          } else if (c.match(/^\s$/)) {
            continue;
          }
          _buffer = _buffer << 6 | decode(c.charCodeAt(0));
          _buflen += 6;
        }
        var n = _buffer >>> _buflen - 8 & 255;
        _buflen -= 8;
        return n;
      };
      var decode = function(c) {
        if (65 <= c && c <= 90) {
          return c - 65;
        } else if (97 <= c && c <= 122) {
          return c - 97 + 26;
        } else if (48 <= c && c <= 57) {
          return c - 48 + 52;
        } else if (c == 43) {
          return 62;
        } else if (c == 47) {
          return 63;
        } else {
          throw "c:" + c;
        }
      };
      return _this;
    };
    var gifImage = function(width, height) {
      var _width = width;
      var _height = height;
      var _data = new Array(width * height);
      var _this = {};
      _this.setPixel = function(x, y, pixel) {
        _data[y * _width + x] = pixel;
      };
      _this.write = function(out) {
        out.writeString("GIF87a");
        out.writeShort(_width);
        out.writeShort(_height);
        out.writeByte(128);
        out.writeByte(0);
        out.writeByte(0);
        out.writeByte(0);
        out.writeByte(0);
        out.writeByte(0);
        out.writeByte(255);
        out.writeByte(255);
        out.writeByte(255);
        out.writeString(",");
        out.writeShort(0);
        out.writeShort(0);
        out.writeShort(_width);
        out.writeShort(_height);
        out.writeByte(0);
        var lzwMinCodeSize = 2;
        var raster = getLZWRaster(lzwMinCodeSize);
        out.writeByte(lzwMinCodeSize);
        var offset = 0;
        while (raster.length - offset > 255) {
          out.writeByte(255);
          out.writeBytes(raster, offset, 255);
          offset += 255;
        }
        out.writeByte(raster.length - offset);
        out.writeBytes(raster, offset, raster.length - offset);
        out.writeByte(0);
        out.writeString(";");
      };
      var bitOutputStream = function(out) {
        var _out = out;
        var _bitLength = 0;
        var _bitBuffer = 0;
        var _this2 = {};
        _this2.write = function(data, length) {
          if (data >>> length != 0) {
            throw "length over";
          }
          while (_bitLength + length >= 8) {
            _out.writeByte(255 & (data << _bitLength | _bitBuffer));
            length -= 8 - _bitLength;
            data >>>= 8 - _bitLength;
            _bitBuffer = 0;
            _bitLength = 0;
          }
          _bitBuffer = data << _bitLength | _bitBuffer;
          _bitLength = _bitLength + length;
        };
        _this2.flush = function() {
          if (_bitLength > 0) {
            _out.writeByte(_bitBuffer);
          }
        };
        return _this2;
      };
      var getLZWRaster = function(lzwMinCodeSize) {
        var clearCode = 1 << lzwMinCodeSize;
        var endCode = (1 << lzwMinCodeSize) + 1;
        var bitLength = lzwMinCodeSize + 1;
        var table = lzwTable();
        for (var i = 0; i < clearCode; i += 1) {
          table.add(String.fromCharCode(i));
        }
        table.add(String.fromCharCode(clearCode));
        table.add(String.fromCharCode(endCode));
        var byteOut = byteArrayOutputStream();
        var bitOut = bitOutputStream(byteOut);
        bitOut.write(clearCode, bitLength);
        var dataIndex = 0;
        var s = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;
        while (dataIndex < _data.length) {
          var c = String.fromCharCode(_data[dataIndex]);
          dataIndex += 1;
          if (table.contains(s + c)) {
            s = s + c;
          } else {
            bitOut.write(table.indexOf(s), bitLength);
            if (table.size() < 4095) {
              if (table.size() == 1 << bitLength) {
                bitLength += 1;
              }
              table.add(s + c);
            }
            s = c;
          }
        }
        bitOut.write(table.indexOf(s), bitLength);
        bitOut.write(endCode, bitLength);
        bitOut.flush();
        return byteOut.toByteArray();
      };
      var lzwTable = function() {
        var _map = {};
        var _size = 0;
        var _this2 = {};
        _this2.add = function(key) {
          if (_this2.contains(key)) {
            throw "dup key:" + key;
          }
          _map[key] = _size;
          _size += 1;
        };
        _this2.size = function() {
          return _size;
        };
        _this2.indexOf = function(key) {
          return _map[key];
        };
        _this2.contains = function(key) {
          return typeof _map[key] != "undefined";
        };
        return _this2;
      };
      return _this;
    };
    var createDataURL = function(width, height, getPixel) {
      var gif = gifImage(width, height);
      for (var y = 0; y < height; y += 1) {
        for (var x = 0; x < width; x += 1) {
          gif.setPixel(x, y, getPixel(x, y));
        }
      }
      var b = byteArrayOutputStream();
      gif.write(b);
      var base64 = base64EncodeOutputStream();
      var bytes = b.toByteArray();
      for (var i = 0; i < bytes.length; i += 1) {
        base64.writeByte(bytes[i]);
      }
      base64.flush();
      return "data:image/gif;base64," + base64;
    };
    return qrcode2;
  })();
  qrcode.stringToBytesFuncs["UTF-8"] = function(s) {
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i = 0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 128) utf8.push(charcode);
        else if (charcode < 2048) {
          utf8.push(
            192 | charcode >> 6,
            128 | charcode & 63
          );
        } else if (charcode < 55296 || charcode >= 57344) {
          utf8.push(
            224 | charcode >> 12,
            128 | charcode >> 6 & 63,
            128 | charcode & 63
          );
        } else {
          i++;
          charcode = 65536 + ((charcode & 1023) << 10 | str.charCodeAt(i) & 1023);
          utf8.push(
            240 | charcode >> 18,
            128 | charcode >> 12 & 63,
            128 | charcode >> 6 & 63,
            128 | charcode & 63
          );
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };
  var qrcode_default = qrcode;

  // monkeypatches/checkout_review/state.js
  var hijackedPaymentFlowDisplayed = false;
  function isHijackedPaymentFlowDisplayed() {
    return hijackedPaymentFlowDisplayed;
  }
  function showHijackedPaymentFlow() {
    hijackedPaymentFlowDisplayed = true;
  }
  function hideHijackedPaymentFlow() {
    hijackedPaymentFlowDisplayed = false;
  }

  // monkeypatches/checkout_review/patches/payment_confirmation_patch.js
  qrcode_default.stringToBytes = qrcode_default.stringToBytesFuncs["UTF-8"];
  var HIJACKED_PAYMENT_CONFIRMATION_ATTR = "data-olx-patch-hijacked-payment-confirmation";
  var PIX_COUNTDOWN_INTERVAL_ATTR = "data-olx-pix-countdown-interval";
  var PIX_EXPIRED_ATTR = "data-olx-pix-expired";
  var PIX_ICON_SVG = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.5455 10.6243C12.2257 10.6243 13.8056 11.2787 14.9938 12.4661L21.4404 18.9141C21.9047 19.3781 22.6628 19.3802 23.1285 18.9134L29.5516 12.4896C30.7398 11.3022 32.3197 10.6478 34.0002 10.6478H34.7738L26.6152 2.48957C24.0745 -0.0512111 19.9554 -0.0512111 17.4147 2.48957L9.27995 10.6243H10.5455ZM34.0006 33.3392C32.3201 33.3392 30.7401 32.6848 29.552 31.4973L23.1288 25.0742C22.678 24.622 21.892 24.6233 21.4411 25.0742L14.9941 31.5208C13.806 32.7083 12.226 33.3623 10.5458 33.3623H9.27995L17.415 41.4977C19.9558 44.0382 24.0751 44.0382 26.6156 41.4977L34.7741 33.3392H34.0006ZM36.5771 12.4594L41.5069 17.3896C44.0477 19.9301 44.0477 24.0494 41.5069 26.5902L36.5771 31.5201C36.4682 31.4766 36.3511 31.4496 36.2267 31.4496H33.9855C32.8263 31.4496 31.6921 30.9798 30.8733 30.1599L24.4501 23.7375C23.2858 22.5721 21.255 22.5724 20.0896 23.7368L13.643 30.1837C12.8238 31.0029 11.6896 31.4728 10.5308 31.4728H7.77439C7.65692 31.4728 7.54671 31.5008 7.44306 31.5398L2.49348 26.5902C-0.0473047 24.0494 -0.0473047 19.9301 2.49348 17.3896L7.44341 12.4397C7.54705 12.4788 7.65692 12.5067 7.77439 12.5067H10.5308C11.6896 12.5067 12.8238 12.9766 13.643 13.7958L20.0903 20.2431C20.6911 20.8436 21.4802 21.1445 22.27 21.1445C23.0592 21.1445 23.849 20.8436 24.4498 20.2428L30.8733 13.8193C31.6921 12.9998 32.8263 12.5299 33.9855 12.5299H36.2267C36.3508 12.5299 36.4682 12.5029 36.5771 12.4594Z" fill="#32BCAD"></path></svg>`;
  var COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M11,8.25 L20,8.25 C21.5187831,8.25 22.75,9.48121694 22.75,11 L22.75,20 C22.75,21.5187831 21.5187831,22.75 20,22.75 L11,22.75 C9.48121694,22.75 8.25,21.5187831 8.25,20 L8.25,11 C8.25,9.48121694 9.48121694,8.25 11,8.25 Z M11,9.75 C10.3096441,9.75 9.75,10.3096441 9.75,11 L9.75,20 C9.75,20.6903559 10.3096441,21.25 11,21.25 L20,21.25 C20.6903559,21.25 21.25,20.6903559 21.25,20 L21.25,11 C21.25,10.3096441 20.6903559,9.75 20,9.75 L11,9.75 Z M5,14.25 C5.41421356,14.25 5.75,14.5857864 5.75,15 C5.75,15.4142136 5.41421356,15.75 5,15.75 L4,15.75 C2.48121694,15.75 1.25,14.5187831 1.25,13 L1.25,4 C1.25,2.48121694 2.48121694,1.25 4,1.25 L13,1.25 C14.5187831,1.25 15.75,2.48121694 15.75,4 L15.75,5 C15.75,5.41421356 15.4142136,5.75 15,5.75 C14.5857864,5.75 14.25,5.41421356 14.25,5 L14.25,4 C14.25,3.30964406 13.6903559,2.75 13,2.75 L4,2.75 C3.30964406,2.75 2.75,3.30964406 2.75,4 L2.75,13 C2.75,13.6903559 3.30964406,14.25 4,14.25 L5,14.25 Z" fill="currentColor"></path></svg>`;
  var ALERTBOX_WARNING_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12,22.75 C6.06293894,22.75 1.25,17.9370611 1.25,12 C1.25,6.06293894 6.06293894,1.25 12,1.25 C17.9370611,1.25 22.75,6.06293894 22.75,12 C22.75,17.9370611 17.9370611,22.75 12,22.75 Z M12,21.25 C17.1086339,21.25 21.25,17.1086339 21.25,12 C21.25,6.89136606 17.1086339,2.75 12,2.75 C6.89136606,2.75 2.75,6.89136606 2.75,12 C2.75,17.1086339 6.89136606,21.25 12,21.25 Z M11.25,8 C11.25,7.58578644 11.5857864,7.25 12,7.25 C12.4142136,7.25 12.75,7.58578644 12.75,8 L12.75,12 C12.75,12.4142136 12.4142136,12.75 12,12.75 C11.5857864,12.75 11.25,12.4142136 11.25,12 L11.25,8 Z M12,16 C11.4477153,16 11,15.5522847 11,15 C11,14.4477153 11.4477153,14 12,14 C12.5522847,14 13,14.4477153 13,15 C13,15.5522847 12.5522847,16 12,16 Z" fill="currentColor"></path></svg>`;
  var COUNTDOWN_CLOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" color="#999999"><path fill-rule="evenodd" d="M12,22.75 C6.06293894,22.75 1.25,17.9370611 1.25,12 C1.25,6.06293894 6.06293894,1.25 12,1.25 C17.9370611,1.25 22.75,6.06293894 22.75,12 C22.75,17.9370611 17.9370611,22.75 12,22.75 Z M12,21.25 C17.1086339,21.25 21.25,17.1086339 21.25,12 C21.25,6.89136606 17.1086339,2.75 12,2.75 C6.89136606,2.75 2.75,6.89136606 2.75,12 C2.75,17.1086339 6.89136606,21.25 12,21.25 Z M12.75,6 L12.75,11.6893398 L15.5303301,14.4696699 C15.8232233,14.7625631 15.8232233,15.2374369 15.5303301,15.5303301 C15.2374369,15.8232233 14.7625631,15.8232233 14.4696699,15.5303301 L11.4696699,12.5303301 C11.3290176,12.3896778 11.25,12.1989124 11.25,12 L11.25,6 C11.25,5.58578644 11.5857864,5.25 12,5.25 C12.4142136,5.25 12.75,5.58578644 12.75,6 Z" fill="#999999"></path></svg>`;
  var LOADING_SPINNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="olx-core-spinner olx-core-spinner--huge" role="status" aria-label="Loading"><path d="M21 12a9 9 0 11-6.219-8.56"></path></svg>`;
  var DEFAULT_PAYMENT_RECIPIENT = "Ifood Pago Ip";
  var creatingPix = false;
  function hijackPaymentConfirmationButton() {
    const button = findConfirmPaymentButton();
    if (!button || button.hasAttribute(HIJACKED_PAYMENT_CONFIRMATION_ATTR)) {
      return;
    }
    const replacement = button.cloneNode(true);
    replacement.setAttribute(HIJACKED_PAYMENT_CONFIRMATION_ATTR, "true");
    replacement.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      onPaymentConfirmationButtonClicked();
    });
    button.replaceWith(replacement);
  }
  function saveMain() {
    const main = getMain();
    if (!main) {
      return null;
    }
    const backup = document.createDocumentFragment();
    for (const child of [...main.childNodes]) {
      backup.appendChild(child);
    }
    return backup;
  }
  function restoreMain(backup) {
    const main = getMain();
    if (!main || !backup) {
      return;
    }
    main.replaceChildren();
    while (backup.firstChild) {
      main.appendChild(backup.firstChild);
    }
  }
  function closeModal() {
    document.getElementById("modal-root")?.replaceChildren();
  }
  function buildPixLoaderPage() {
    const root = document.createElement("div");
    root.className = "flex h-full flex-col items-center gap-2 justify-center pt-0 pb-10";
    root.dataset.testid = "PixLoader";
    root.innerHTML = `
        <div class="flex w-full max-w-xl flex-col items-center justify-center gap-2 px-4">
            <div class="flex flex-col items-center justify-center">
                <div class="rounded-5 flex">${LOADING_SPINNER_SVG}</div>
                <div class="mt-2 flex flex-col text-center">
                    <span class="typo-title-large mb-1 text-center">Estamos gerando seu c\xF3digo PIX. Aguarde...</span>
                </div>
            </div>
        </div>
    `;
    return root;
  }
  function showError(message) {
    const main = getMain();
    if (!main) {
      return;
    }
    const alertWrapper = document.createElement("div");
    alertWrapper.className = "px-4 pt-4";
    alertWrapper.setAttribute("data-olx-patch-payment-error", "true");
    alertWrapper.innerHTML = `
        <div data-ds-componet="DS-Alertbox" class="olx-alertbox olx-alertbox--error" role="alert" title="">
            <div class="olx-alertbox__content-wrapper">
                <div class="olx-alertbox__content">
                    <div class="olx-alertbox__description">
                        <p class="typo-body-medium">${escapeHtml(message)}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    main.prepend(alertWrapper);
  }
  async function onPaymentConfirmationButtonClicked() {
    if (creatingPix) {
      return;
    }
    creatingPix = true;
    let mainBackup = null;
    try {
      const value = getPixPaymentValue();
      const adId = getAdId2();
      mainBackup = saveMain();
      closeModal();
      showHijackedPaymentFlow();
      setMain(buildPixLoaderPage());
      const payment = await createPixPaymentAsync({ adId, value });
      const pixCode = payment?.pixCode;
      if (!pixCode) {
        throw new Error(payment?.error ?? payment?.message ?? "N\xE3o foi poss\xEDvel gerar o c\xF3digo Pix.");
      }
      setMain(buildPixQrCodePage({
        pixCode,
        value: payment.value ?? value,
        expirationTimeSeconds: payment.expirationTimeSeconds,
        paymentRecipient: payment.paymentRecipient ?? DEFAULT_PAYMENT_RECIPIENT
      }));
    } catch (error) {
      hideHijackedPaymentFlow();
      if (mainBackup) {
        restoreMain(mainBackup);
      }
      const message = error instanceof Error ? error.message : "N\xE3o foi poss\xEDvel gerar o c\xF3digo Pix.";
      showError(message);
      console.error("onPaymentConfirmationButtonClicked:", error);
    } finally {
      creatingPix = false;
    }
  }
  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function formatPixPrice(value) {
    return `R$ ${Number(value).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  function expiresAtFromSeconds(expirationTimeSeconds) {
    const seconds = Number(expirationTimeSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return Date.now();
    }
    return Date.now() + seconds * 1e3;
  }
  function formatCountdown(remainingMs) {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1e3));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  function stopCountdown(root) {
    const intervalId = Number(root.getAttribute(PIX_COUNTDOWN_INTERVAL_ATTR));
    if (intervalId) {
      clearInterval(intervalId);
      root.removeAttribute(PIX_COUNTDOWN_INTERVAL_ATTR);
    }
  }
  function startCountdown(root, expirationTimeSeconds, { onExpired } = {}) {
    stopCountdown(root);
    const expiresAt = expiresAtFromSeconds(expirationTimeSeconds);
    const totalDurationMs = Math.max(1, expiresAt - Date.now());
    const barTrack = root.querySelector("[data-olx-pix-countdown-bar-track]");
    const timerLabel = root.querySelector("[data-olx-pix-countdown-label]");
    if (!barTrack || !timerLabel) {
      return;
    }
    let hasExpired = false;
    const updateCountdown = () => {
      const remainingMs = Math.max(0, expiresAt - Date.now());
      const barWidth = remainingMs / totalDurationMs * 100;
      barTrack.style.setProperty("--bar-width", `${barWidth}%`);
      timerLabel.textContent = formatCountdown(remainingMs);
      if (remainingMs <= 0) {
        stopCountdown(root);
        if (!hasExpired) {
          hasExpired = true;
          onExpired?.();
        }
      }
    };
    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1e3);
    root.setAttribute(PIX_COUNTDOWN_INTERVAL_ATTR, String(intervalId));
  }
  function getMain() {
    return document.getElementById("main");
  }
  function setMain(content) {
    const main = getMain();
    if (!main || !content) {
      return;
    }
    main.replaceChildren(content);
  }
  function wireExpiredPixPageButtons(root) {
    const viewAdButton = root.querySelector("[data-olx-pix-view-ad-button]");
    if (viewAdButton) {
      viewAdButton.addEventListener("click", (event) => {
        event.preventDefault();
        window.history.back();
      });
    }
    const purchaseDetailsButton = root.querySelector("[data-olx-pix-purchase-details-button]");
    if (purchaseDetailsButton) {
      purchaseDetailsButton.hidden = true;
    }
  }
  function buildExpiredPixPage() {
    const root = document.createElement("div");
    root.className = "flex h-full flex-col items-center gap-2 pt-6";
    root.dataset.testid = "ExpiredPixViewComponent";
    root.innerHTML = `
        <div class="flex w-full max-w-xl flex-col items-center justify-center gap-2 px-4">
            <div class="flex flex-col items-center justify-center">
                <div class="rounded-5 flex">${EXPIRED_PIX_ILLUSTRATION_SVG}</div>
                <div class="mt-2 flex flex-col text-center">
                    <span class="typo-title-large mb-1 text-center">O c\xF3digo Pix expirou</span>
                    <span class="typo-body-medium">O prazo para pagamento do seu pedido expirou, volte ao an\xFAncio e realize a compra novamente.</span>
                    <span class="typo-body-medium">Se voc\xEA j\xE1 pagou, aguarde a confirma\xE7\xE3o em detalhes da compra.</span>
                </div>
            </div>
        </div>
        <div class="bg-neutral-70 border-neutral-90 space-y-0-5 sticky bottom-0 mt-auto w-full border-t p-2 md:mt-0 md:max-w-lg md:border-t-0 md:pt-0 lg:relative">
            <button type="button" class="olx-core-button olx-core-button--primary olx-core-button--medium w-full" data-olx-pix-view-ad-button>Ver an\xFAncio</button>
            <button type="button" class="olx-core-button olx-core-button--link olx-core-button--medium w-full" data-olx-pix-purchase-details-button hidden>Detalhes da compra</button>
        </div>
    `;
    wireExpiredPixPageButtons(root);
    return root;
  }
  function showExpiredPixPage() {
    if (document.querySelector(`[${PIX_EXPIRED_ATTR}="true"]`)) {
      return;
    }
    const expiredPage = buildExpiredPixPage();
    expiredPage.setAttribute(PIX_EXPIRED_ATTR, "true");
    setMain(expiredPage);
  }
  async function copyCode(pixCode) {
    try {
      await navigator.clipboard.writeText(pixCode);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = pixCode;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }
  function wireCopyButtons(root, pixCode) {
    for (const button of root.querySelectorAll("[data-olx-pix-copy-button]")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        copyCode(pixCode);
      });
    }
  }
  function createQrImage(pixCode) {
    const qr = qrcode_default(0, "M");
    qr.addData(pixCode);
    qr.make();
    const moduleCount = qr.getModuleCount();
    const targetSize = 256;
    const margin = 4;
    const cellSize = Math.max(1, Math.floor((targetSize - margin * 2) / moduleCount));
    const image = document.createElement("img");
    image.width = targetSize;
    image.height = targetSize;
    image.alt = "QR Code Pix";
    image.className = "block";
    image.src = qr.createDataURL(cellSize, margin);
    return image;
  }
  function buildPixQrCodePage({ pixCode, value, expirationTimeSeconds, paymentRecipient }) {
    const safePixCode = escapeHtml(pixCode);
    const safePaymentRecipient = escapeHtml(paymentRecipient);
    const formattedValue = escapeHtml(formatPixPrice(value));
    const root = document.createElement("div");
    root.className = "pb-2";
    root.dataset.testid = "PixViewComponent";
    root.innerHTML = `
        <div class="border-neutral-90 rounded-1 mx-auto my-2 w-full max-w-xl self-center border p-4 pb-2">
            <div data-ds-componet="DS-Alertbox" class="olx-alertbox olx-alertbox--warning" role="status" title="">
                <div class="olx-alertbox__content-wrapper">
                    <span class="olx-alertbox__icon-wrapper" aria-hidden="true">${ALERTBOX_WARNING_ICON_SVG}</span>
                    <div class="olx-alertbox__content">
                        <span class="olx-alertbox__title" title=""></span>
                        <div class="olx-alertbox__description">
                            <p class="typo-body-medium font-semibold">
                                <span>N\xE3o pedimos comprovante do Pix e nem enviamos por e-mail. A OLX, em parceria com a</span>
                                <span><strong> ${safePaymentRecipient}</strong></span>
                                <span>, cuida do pagamento at\xE9 voc\xEA receber seu produto!</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <button type="button" class="my-3 block w-full cursor-pointer border-0 bg-transparent p-0 text-left" data-testid="countdown-wrapper">
                <div class="bg-neutral-80">
                    <div class="flex h-[4px] w-full bg-neutral-100 transition-all duration-2 ease-in-out" data-olx-pix-countdown-bar-track style="--bar-width: 100%;">
                        <div class="bg-primary-100 h-full w-(--bar-width)"></div>
                    </div>
                    <p class="pt-1-5 pr-0-5 pl-0-5 flex items-center justify-center gap-1 pb-1">
                        ${COUNTDOWN_CLOCK_ICON_SVG}
                        <span class="typo-body-medium lg:text-2-5 font-bold">Seu c\xF3digo expira em:</span>
                        <span class="typo-body-medium lg:text-2-5 text-primary-100 font-bold" data-olx-pix-countdown-label>00m 00s</span>
                    </p>
                </div>
            </button>
            <div class="my-3 flex justify-center">
                <div class="flex items-center [&_svg]:h-4 [&_svg]:w-4">
                    ${PIX_ICON_SVG}
                    <div class="ml-1">
                        <span class="typo-body-large block">Pague por Pix</span>
                        <span class="typo-body-large block font-bold">${formattedValue}</span>
                    </div>
                </div>
                <div class="mx-2 w-[1px] bg-[--divider-default-background-color]"></div>
                <div class="flex items-center [&_svg]:h-4 [&_svg]:w-4">
                    <div class="ml-1">
                        <span class="typo-body-large block">Processado por</span>
                        <span class="typo-body-large block font-bold">${safePaymentRecipient}</span>
                    </div>
                </div>
            </div>
            <hr class="olx-divider olx-mb-2" data-ds-component="DS-Divider">
            <span class="typo-body-medium block pb-2">\xC9 r\xE1pido e pr\xE1tico. Veja como \xE9 f\xE1cil:</span>
            <span class="typo-body-medium block pb-2">1. Abra o app ou banco de sua prefer\xEAncia, escolha a op\xE7\xE3o pagar via Pix</span>
            <span class="typo-body-medium block pb-2">2. Escolha pagar Pix com QR Code e escaneie o c\xF3digo abaixo:</span>
            <span class="typo-body-medium block pb-2">
                <span>3. Confira se o pagamento ser\xE1 feito para nosso parceiro </span>
                <strong>${safePaymentRecipient}</strong>, que antes respondia por<strong> Zoop tecnologia</strong>,
                <span> e se todas as informa\xE7\xF5es est\xE3o corretas.</span>
            </span>
            <span class="typo-body-medium block pb-2">4. Confirme o pagamento.</span>
            <div class="mt-4 mb-4 flex justify-center" data-olx-pix-qr-code></div>
            <hr class="olx-divider olx-mb-2" data-ds-component="DS-Divider">
            <span class="typo-title-small block pb-2">Ou se preferir, fa\xE7a o pagamento com o Pix copia e cola</span>
            <span class="typo-body-medium block pb-2">
                <span>Acesse o app do seu banco ou Internet Banking, escolha a op\xE7\xE3o pagar com</span>
                <span><strong> Pix copia e cola</strong></span>
                <span>. Depois cole o c\xF3digo, confira se o pagamento ser\xE1 feito para nosso parceiro </span>
                <span><strong>${safePaymentRecipient}</strong></span>
                <span> e se todas as informa\xE7\xF5es est\xE3o corretas. Confirme o pagamento.</span>
            </span>
            <div>
                <pre data-ds-component="DS-Container" class="!bg-neutral-90 m-0 !mb-2 olx-container olx-container--outlined olx-d-flex olx-pl-1-5 olx-pb-1 olx-pt-1 olx-pr-1-5 olx-ai-center olx-jc-space-between">
                    <span class="typo-body-medium text-neutral-120 overflow-hidden font-bold text-ellipsis whitespace-nowrap">${safePixCode}</span>
                    <button class="olx-core-button olx-core-button--link olx-core-button--small" data-olx-pix-copy-button>Copiar</button>
                </pre>
                <button class="olx-core-button olx-core-button--primary olx-core-button--small w-full" data-olx-pix-copy-button>${COPY_ICON_SVG} Copiar c\xF3digo Pix</button>
            </div>
            <p class="typo-body-medium font-semibold">
                Prontinho! A aprova\xE7\xE3o \xE9 imediata e voc\xEA pode acompanhar o seu pedido em&nbsp;
                <a data-ds-component="DS-Link" class="olx-link olx-link--medium olx-link--main" href="https://meus-pedidos.olx.com.br/compras" target="_blank">Minhas Compras</a>
            </p>
        </div>
    `;
    const qrCodeContainer = root.querySelector("[data-olx-pix-qr-code]");
    if (qrCodeContainer) {
      qrCodeContainer.appendChild(createQrImage(pixCode));
    }
    wireCopyButtons(root, pixCode);
    startCountdown(root, expirationTimeSeconds, { onExpired: showExpiredPixPage });
    return root;
  }
  function patchPaymentConfirmation() {
    hijackPaymentConfirmationButton();
  }

  // monkeypatches/checkout_review/patches/payment_options_patch.js
  var UNAVAILABLE_PATCH_ATTR = "data-olx-patch-unavailable";
  var UNAVAILABLE_LABEL_ATTR = "data-olx-patch-unavailable-label";
  var HIDDEN_PIX_DISCOUNT_ATTR = "data-olx-patch-hidden-pix-discount";
  var PIX_PAYMENT_NAME2 = "Pix";
  var PIX_DISCOUNT_BADGE_PREFIX = "economia de";
  function appendUnavailableLabel(container) {
    if (!container || container.querySelector(`[${UNAVAILABLE_LABEL_ATTR}]`)) {
      return;
    }
    const label = document.createElement("span");
    label.className = "typo-caption text-neutral-110 block";
    label.setAttribute(UNAVAILABLE_LABEL_ATTR, "true");
    label.textContent = "N\xE3o dispon\xEDvel";
    container.appendChild(label);
  }
  function disableInputs(target) {
    for (const input of target.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
      input.disabled = true;
      const radioRoot = input.closest(".olx-core-radio__root, .olx-core-checkbox-radio__root");
      if (radioRoot) {
        radioRoot.classList.add("olx-core-checkbox-radio__root--disabled");
      }
    }
  }
  function disablePaymentMethodTarget(target, { unavailableLabelContainer } = {}) {
    if (!(target instanceof HTMLElement) || target.hasAttribute(UNAVAILABLE_PATCH_ATTR)) {
      return;
    }
    target.style.pointerEvents = "none";
    target.style.opacity = "var(--opacity-64)";
    target.classList.remove("cursor-pointer");
    if (target.classList.contains("border-secondary-100")) {
      target.classList.remove("border-secondary-100");
      target.classList.add("border-[var(--container-border-color-outlined)]");
    }
    disableInputs(target);
    if (unavailableLabelContainer) {
      appendUnavailableLabel(unavailableLabelContainer);
    }
    target.setAttribute(UNAVAILABLE_PATCH_ATTR, "true");
  }
  function isPixDiscountBadge(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (!element.classList.contains("olx-core-badge")) {
      return false;
    }
    return normalizeText(element.textContent).toLowerCase().startsWith(PIX_DISCOUNT_BADGE_PREFIX);
  }
  function hidePixDiscountBadgeContainer(container) {
    if (!(container instanceof HTMLElement) || container.hasAttribute(HIDDEN_PIX_DISCOUNT_ATTR)) {
      return;
    }
    container.style.display = "none";
    container.setAttribute(HIDDEN_PIX_DISCOUNT_ATTR, "true");
  }
  function suppressPixDiscount() {
    const wrapper = findPaymentOptionsWrapper();
    if (!wrapper) {
      return;
    }
    const pixCard = findDigitalPaymentMethodCards(wrapper).find(({ name }) => name === PIX_PAYMENT_NAME2);
    if (!pixCard) {
      return;
    }
    for (const badge of pixCard.card.querySelectorAll(".olx-core-badge")) {
      if (!isPixDiscountBadge(badge)) {
        continue;
      }
      const container = badge.closest("div.mt-0-5") ?? badge;
      hidePixDiscountBadgeContainer(container);
    }
  }
  function suppressNonPixPaymentOptions() {
    const wrapper = findPaymentOptionsWrapper();
    if (!wrapper) {
      console.info("patchPaymentOptions: no payment options wrapper found");
      return;
    }
    const cards = findDigitalPaymentMethodCards(wrapper);
    let pixInput = null;
    for (const { name, card, input } of cards) {
      if (name === PIX_PAYMENT_NAME2) {
        pixInput = input;
        continue;
      }
      const labelContainer = card.querySelector("div.w-full") ?? card;
      disablePaymentMethodTarget(card, { unavailableLabelContainer: labelContainer });
    }
    if (pixInput) {
      pixInput.checked = true;
    }
    const creditCardSection = findCreditCardSection(wrapper);
    if (creditCardSection) {
      disablePaymentMethodTarget(creditCardSection, { unavailableLabelContainer: creditCardSection });
    }
    const addCreditCardContainer = findAddCreditCardContainer(wrapper);
    if (addCreditCardContainer) {
      disablePaymentMethodTarget(addCreditCardContainer, { unavailableLabelContainer: addCreditCardContainer });
    }
  }
  function patchPaymentOptions() {
    suppressPixDiscount();
    suppressNonPixPaymentOptions();
  }

  // monkeypatches/checkout_review/patch.js
  async function patchCheckoutReviewPageAsync() {
    if (!isCurrentPageACheckoutReviewPage()) {
      return;
    }
    if (isHijackedPaymentFlowDisplayed()) {
      return;
    }
    patchCouponBox();
    patchPaymentOptions();
    const adId = getAdId2();
    const adPatch = await getAdPatchAsync(adId);
    if (adPatch) {
      patchCheckoutSummary(adPatch);
    }
    patchPaymentConfirmation();
  }

  // main.js
  var PATCH_INTERVAL_MS = 150;
  var PATCHES = [
    patchAdDetailsAsync,
    patchCheckoutReviewPageAsync
  ];
  async function patchAsync() {
    for (const patch of PATCHES) {
      try {
        await patch();
      } catch (error) {
        console.error(`Error running patch ${patch.constructor.name}:`, error);
      }
    }
  }
  initializeCaches();
  patchAsync();
  setInterval(patchAsync, PATCH_INTERVAL_MS);
})();
