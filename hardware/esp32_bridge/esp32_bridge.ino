// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
//
// *** UNTESTED *** This sketch has never been compiled or run on hardware. It was written
// against the library APIs from memory. Expect to fix small compile errors on first build.
//
// ESP32 bridge for the SPHEREx Time Cube: WiFi + WebSocket client to /ws/hardware.
// Parts: one rotary encoder (time), one arcade button (play), analog joystick (tilt),
// a NeoPixel ring (direction + sharpness of the current tilt). Schema: hardware/EVENTS.md.
//
// Libraries (Arduino Library Manager): "WebSockets" by Markus Sattler (arduinoWebSockets,
// LGPL-2.1), "ArduinoJson" by Benoit Blanchon (MIT), "Adafruit NeoPixel" (LGPL-3.0).
// Board package: "esp32" by Espressif (WiFi.h). Copy secrets.example.h to secrets.h first.

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include "secrets.h"

// ---- pins and tuning (edit for your wiring) ----
const int PIN_ENC_A = 32;
const int PIN_ENC_B = 33;
const int PIN_BUTTON = 25;      // to GND, internal pull-up
const int PIN_JOY_X = 34;       // analog, 0..4095
const int PIN_JOY_Y = 35;
const int PIN_RING = 27;
const int RING_LEDS = 16;
const int JOY_CENTER = 2048;
const int JOY_DEADZONE = 150;   // raw counts around centre ignored
const unsigned long JOY_PERIOD_MS = 100;

WebSocketsClient ws;
Adafruit_NeoPixel ring(RING_LEDS, PIN_RING, NEO_GRB + NEO_KHZ800);
bool connected = false;
volatile int encDelta = 0;
int lastA = HIGH;
bool lastButton = HIGH;
unsigned long lastJoy = 0;
float lastX = 0, lastY = 0;

void IRAM_ATTR onEncoder() {
  int a = digitalRead(PIN_ENC_A);
  if (a != lastA && a == LOW) encDelta += (digitalRead(PIN_ENC_B) == HIGH) ? 1 : -1;
  lastA = a;
}

void sendJson(JsonDocument &doc) {
  if (!connected) return;
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
}

float axis(int pin) {
  int raw = analogRead(pin) - JOY_CENTER;
  if (abs(raw) < JOY_DEADZONE) return 0;
  return constrain(raw / 2048.0f, -1.0f, 1.0f);
}

// angle_deg: 0 = north (top LED), clockwise; sharpness 0..1 sets brightness.
void showRing(float angleDeg, float sharpness) {
  int lit = ((int)roundf(angleDeg / 360.0f * RING_LEDS)) % RING_LEDS;
  ring.clear();
  uint8_t level = (uint8_t)(30 + 225 * constrain(sharpness, 0.0f, 1.0f));
  ring.setPixelColor(lit, ring.Color(level, level / 2, 0));
  ring.show();
}

void showStatus(const char *state) {
  ring.clear();
  uint32_t c = strcmp(state, "candidate") == 0 ? ring.Color(0, 120, 0)
             : strcmp(state, "processing") == 0 ? ring.Color(0, 0, 120)
             : ring.Color(20, 20, 20);
  for (int i = 0; i < RING_LEDS; i += 4) ring.setPixelColor(i, c);
  ring.show();
}

void onWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) { connected = true; Serial.println("ws connected"); }
  else if (type == WStype_DISCONNECTED) { connected = false; Serial.println("ws disconnected"); }
  else if (type == WStype_TEXT) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, payload, length)) return;
    const char *kind = doc["type"] | "";
    if (strcmp(kind, "led_ring") == 0) showRing(doc["angle_deg"] | 0.0f, doc["sharpness"] | 0.0f);
    else if (strcmp(kind, "status") == 0) showStatus(doc["state"] | "ready");
    // "oled": add your display driver here and print doc["lines"].
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_ENC_A, INPUT_PULLUP);
  pinMode(PIN_ENC_B, INPUT_PULLUP);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_A), onEncoder, CHANGE);
  ring.begin();
  ring.setBrightness(80);
  showStatus("ready");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println(WiFi.localIP());
  String path = String("/ws/hardware?role=device");
  if (strlen(HW_TOKEN) > 0) path += String("&token=") + HW_TOKEN;
  ws.begin(SERVER_HOST, SERVER_PORT, path);  // plain ws; use beginSSL() behind HTTPS
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(3000);
}

void loop() {
  ws.loop();

  int d = encDelta;
  if (d != 0) {
    encDelta = 0;
    StaticJsonDocument<96> doc;
    doc["type"] = "encoder"; doc["id"] = "time"; doc["delta"] = constrain(d, -20, 20);
    sendJson(doc);
  }

  bool b = digitalRead(PIN_BUTTON);
  if (b != lastButton) {
    lastButton = b;
    delay(15);  // crude debounce
    StaticJsonDocument<96> doc;
    doc["type"] = "button"; doc["id"] = "play"; doc["state"] = (b == LOW) ? "down" : "up";
    sendJson(doc);
  }

  if (millis() - lastJoy > JOY_PERIOD_MS) {
    lastJoy = millis();
    float x = axis(PIN_JOY_X), y = -axis(PIN_JOY_Y);  // flip Y so up = north
    if (fabsf(x - lastX) > 0.05f || fabsf(y - lastY) > 0.05f) {
      lastX = x; lastY = y;
      StaticJsonDocument<96> doc;
      doc["type"] = "joystick"; doc["x"] = x; doc["y"] = y;
      sendJson(doc);
    }
  }
}
