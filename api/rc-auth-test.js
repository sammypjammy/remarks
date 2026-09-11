export default async function handler(req, res) {
  try {
    const clientId = process.env.RC_CLIENT_ID;
    const clientSecret = process.env.RC_CLIENT_SECRET;
    const jwt = process.env.RC_USER_JWT;

    if (!clientId || !clientSecret || !jwt) {
      return res.status(500).json({
        success: false,
        error: "Missing RingCentral environment variables",
      });
    }

    const basicAuth = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });

    const response = await fetch(
      "https://platform.ringcentral.com/restapi/oauth/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("RingCentral auth failed:", data);

      return res.status(response.status).json({
        success: false,
        error: data.error,
        description: data.error_description,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Successfully authenticated with RingCentral",
      expiresIn: data.expires_in,
      scope: data.scope,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Unexpected server error",
    });
  }
}