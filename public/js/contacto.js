const form = document.querySelector("[data-contact-form]");
const status = document.querySelector("[data-form-status]");
const messages = { nombre: "Ingresá un nombre de al menos 2 caracteres.", email: "Ingresá un email válido.", mensaje: "Escribí un mensaje de al menos 10 caracteres." };

function validateField(field) {
  const valid = field.checkValidity(); field.setAttribute("aria-invalid", String(!valid));
  const error = form.querySelector(`[data-error-for="${field.name}"]`); if (error) error.textContent = valid ? "" : messages[field.name];
  return valid;
}

form?.addEventListener("input", (event) => { if (event.target.matches("input, textarea")) validateField(event.target); });
form?.addEventListener("submit", (event) => {
  event.preventDefault(); const fields = [...form.querySelectorAll("input, textarea")]; const valid = fields.every(validateField);
  if (!valid) { status.textContent = "Revisá los campos señalados."; fields.find((field) => !field.checkValidity())?.focus(); return; }
  status.textContent = "El formulario es válido, pero el envío todavía no está conectado. No se envió ningún mensaje.";
});
