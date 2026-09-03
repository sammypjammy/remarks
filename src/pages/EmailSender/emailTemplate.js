export const TEMPLATE_PLACEHOLDERS = Object.freeze([
  "{{caseManagerName}}",
  "{{caseManagerFirstName}}",
  "{{caseManagerPhone}}",
  "{{caseManagerEmail}}",
  "{{videoSection}}",
]);

export const DEFAULT_EMAIL_TEMPLATES = Object.freeze({
  english: {
    subject: "Welcome to Packard Law Firm!",
    body: `Good afternoon,

Your case has been set up and all necessary filings are complete. I have assigned you to a great case manager, {{caseManagerName}}. Attached is {{caseManagerName}}'s contact information, as well as videos, and a welcome packet from our firm giving additional important information.

{{caseManagerName}}'s Contact Information:
Phone: {{caseManagerPhone}}
Email: {{caseManagerEmail}}

{{videoSection}}

Additionally, I wanted to tell you about an app we use called Case Status. Our other clients like it and find it to be very helpful when communicating with us. On our end, we will post updates about your claim. On your end, you can use the app to communicate with your case manager. It is particularly helpful if you use it to tell us about:
• Any change in medical providers or medications
• Any ongoing medical appointments, including ER visits or hospitalizations
• Any mail you receive from the Social Security Administration
• Any other questions you have

Please download the app to gain quick updates to your case and easy access to your case manager. A link will be sent to your phone with an invitation to download the Case Status app. If you haven't received the link yet, we've included a link below or if you have any other questions, {{caseManagerFirstName}} will be happy to assist.

Case Status App. Download: http://www.casestatus.com/downloadapp

It's been a pleasure working with you, and I know that you are in good hands with your case manager.

Thank you,`,
  },
  spanish: {
    subject: "¡Bienvenido a Packard Law Firm!",
    body: `Buenas tardes,

Su caso ha sido establecido y todas las presentaciones necesarias están completas. Le he asignado una excelente administradora o un excelente administrador de casos, {{caseManagerName}}. Adjunto encontrará la información de contacto de {{caseManagerName}}, videos y un paquete de bienvenida de nuestra firma con información adicional importante.

Información de contacto de {{caseManagerName}}:
Teléfono: {{caseManagerPhone}}
Correo electrónico: {{caseManagerEmail}}

{{videoSection}}

También quería informarle sobre una aplicación que usamos llamada Case Status. A nuestros clientes les resulta muy útil para comunicarse con nosotros. Nosotros publicaremos actualizaciones sobre su solicitud y usted podrá usar la aplicación para comunicarse con su administrador de casos. Es especialmente útil para informarnos sobre:
• Cualquier cambio de proveedores médicos o medicamentos
• Cualquier cita médica pendiente, incluidas visitas a emergencias u hospitalizaciones
• Cualquier correspondencia que reciba de la Administración del Seguro Social
• Cualquier otra pregunta que tenga

Descargue la aplicación para recibir actualizaciones rápidas sobre su caso y comunicarse fácilmente con su administrador de casos. Recibirá en su teléfono una invitación para descargar Case Status. Si aún no ha recibido el enlace o tiene alguna pregunta, {{caseManagerFirstName}} estará disponible para ayudarle.

Descargar Case Status: http://www.casestatus.com/downloadapp

Ha sido un placer trabajar con usted y sé que está en buenas manos con su administrador de casos.

Gracias,`,
  },
});

export function mergeEmailTemplates(savedTemplates) {
  return Object.fromEntries(Object.entries(DEFAULT_EMAIL_TEMPLATES).map(([language, defaults]) => [
    language,
    {
      subject: savedTemplates?.[language]?.subject?.trim() || defaults.subject,
      body: savedTemplates?.[language]?.body?.trim() || defaults.body,
    },
  ]));
}

function buildVideoSection(caseManager, language) {
  const isSpanish = language === "spanish";
  const lines = isSpanish
    ? [
        "Lista de videos:",
        "Bienvenido a Packard Law Firm: https://youtu.be/50BLOdPsrEw",
        "Qué esperar: https://youtu.be/-Bqpx0qiips",
        "Información importante: https://youtu.be/gE7zTKGbmVY",
      ]
    : [
        "Video List:",
        "Welcome to the Packard Law Firm: https://youtu.be/50BLOdPsrEw",
        "What to Expect: https://youtu.be/-Bqpx0qiips",
        "Important information: https://youtu.be/gE7zTKGbmVY",
      ];

  if (caseManager.introVideo) {
    lines.push(`${isSpanish ? "Video de introducción del administrador de casos" : "(Case Manager) Intro. Video"}: ${caseManager.introVideo}`);
  }
  return lines.join("\n");
}

function renderTemplate(text, caseManager, language) {
  const values = {
    "{{caseManagerName}}": caseManager.fullName,
    "{{caseManagerFirstName}}": caseManager.firstName || caseManager.fullName.split(/\s+/)[0],
    "{{caseManagerPhone}}": caseManager.phone,
    "{{caseManagerEmail}}": caseManager.email,
    "{{videoSection}}": buildVideoSection(caseManager, language),
  };
  return Object.entries(values).reduce((result, [placeholder, value]) => result.split(placeholder).join(value || ""), text);
}

export function buildWelcomeSubject(caseManager, template, language = "english") {
  const selectedTemplate = template || DEFAULT_EMAIL_TEMPLATES[language] || DEFAULT_EMAIL_TEMPLATES.english;
  return caseManager ? renderTemplate(selectedTemplate.subject, caseManager, language) : selectedTemplate.subject;
}

export function buildWelcomeEmail(caseManager, emailSignature, template, language = "english") {
  if (!caseManager) return "";
  const selectedTemplate = template || DEFAULT_EMAIL_TEMPLATES[language] || DEFAULT_EMAIL_TEMPLATES.english;
  const body = renderTemplate(selectedTemplate.body, caseManager, language).trim();
  const signature = emailSignature
    ? `- ${emailSignature.name}\n${emailSignature.position}\n${emailSignature.phone}`
    : "";
  return `${body}${signature ? `\n\n${signature}` : ""}`;
}
