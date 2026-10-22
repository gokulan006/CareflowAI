
const API_URL = import.meta.env.VITE_API_URL || "/api";

async function fetchApi(url, options) {
    try {
        return await fetch(url, options);
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error(
                "Cannot reach the CareFlow server. Check that Django is running at http://127.0.0.1:8000.",
                { cause: error },
            );
        }
        throw error;
    }
}



export async function getCsrfToken() {
    const response = await fetchApi(`${API_URL}/csrf/`, {
        credentials: "include",
    });

    if (!response.ok) {
        throw new Error(`Could not obtain the CSRF token (HTTP ${response.status}).`);
    }

    // Prefer Django's masked token if available.
    const cookieToken = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("csrftoken="))
        ?.split("=")
        .slice(1)
        .join("=");

    if (!cookieToken) {
        throw new Error(
            "CSRF cookie missing. Check browser cookie settings and CORS."
        );
    }

    return decodeURIComponent(cookieToken);
}



export async function apiRequest(endpoint, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = { ...options.headers };

    if (!(options.body instanceof FormData) && options.body) {
        headers["Content-Type"] = "application/json";
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        headers["X-CSRFToken"] = await getCsrfToken();
    }
    
    const response = await fetchApi(`${API_URL}${endpoint}`, {
        ...options,
        method,
        headers,
        credentials: "include",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const formatErrors = (value) => Array.isArray(value)
            ? value.map(formatErrors).join(" ")
            : value && typeof value === "object"
                ? Object.entries(value).map(([field, error]) => `${field}: ${formatErrors(error)}`).join("; ")
                : String(value);
        const message = data?.detail || (data && typeof data === "object"
            ? Object.entries(data).map(([field, errors]) => `${field}: ${formatErrors(errors)}`).join("; ")
            : "");
        throw new Error(message || `Request failed: ${response.status}`);
    }

    return data;
}

export async function uploadAudioForTranscription(audioBlob, filename = "voice-input.webm") {
    const formData = new FormData();
    formData.append("audio", audioBlob, filename);
    return await apiRequest("/transcribe/", {
        method: "POST",
        body: formData,
    });
}

export async function downloadAttachment(attachmentId, originalFilename = "report.pdf") {
    const csrfToken = await getCsrfToken().catch(() => "");
    const response = await fetchApi(`${API_URL}/attachments/${attachmentId}/download/`, {
        credentials: "include",
        headers: csrfToken ? { "X-CSRFToken": csrfToken } : {},
    });
    if (!response.ok) {
        throw new Error(`Attachment download failed (${response.status}).`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = originalFilename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
