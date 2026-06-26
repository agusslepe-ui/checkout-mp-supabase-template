const payButton = document.getElementById("pay-button");
const statusMessage = document.getElementById("status-message");

function setStatus(message) {
  statusMessage.textContent = message;
}

payButton.addEventListener("click", async () => {
  payButton.disabled = true;
  setStatus("Preparando pago...");

  try {
    const response = await fetch("/crear-preferencia", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sku: "REMERA-LEMONT-001",
        quantity: 1,
      }),
    });

    if (!response.ok) {
      throw new Error("No se pudo crear la preferencia");
    }

    const preference = await response.json();
    const checkoutUrl =
      preference.init_point || preference.sandbox_init_point;

    if (!checkoutUrl) {
      throw new Error("La preferencia no incluye link de pago");
    }

    setStatus("Redirigiendo a Mercado Pago...");
    window.location.href = checkoutUrl;
  } catch (error) {
    console.error(error);
    setStatus("Error creando preferencia");
    payButton.disabled = false;
  }
});
