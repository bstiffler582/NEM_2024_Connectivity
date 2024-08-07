## Connectivity Lab 1 - MQTT

### Contents
1. [Introduction](#introduction)
2. [Dependencies](#dependencies)
3. [Publishing](#publishing)
4. [JSON](#json)
5. [Subscribing](#subscribing)
6. [Summary](#summary)

---

<a id="introduction"></a>

### 1. Introduction

MQTT tooling in TwinCAT is particularly simple and comprehensive. In this lab, we will demonstrate basic usage of the MQTT client libraries to publish and subscribe to a web-hosted broker. You will also gain exposure to JSON handling and the use of the `ANY` type for writing generic, reusable functions.

<a id="dependencies"></a>

### 2. Dependencies

This lab uses TwinCAT 3.1 and the TF6701 IoT Communication library. If you are using 4024, the required libraries are already installed and available. If using 4026, you will need to add the TF6701 package via the Package Manager. We will also be using the [*MQTTk*](https://github.com/matesh/mqttk/releases) client tool for testing. If you already have a favorite MQTT client interface, feel free to use that as well.

<a id="publishing"></a>

### 3. Publishing

Create a fresh TwinCAT / PLC Project and add the following PLC library references:
- Tc2_Utilities
- Tc3_IotBase
- Tc3_JsonXml

Create a new DUT with some information to send:
```js
TYPE DUT_Message :
STRUCT
  Id            : DINT;
  Message       : STRING(255);
END_STRUCT
END_TYPE
```

Back in `MAIN`, let's create an instance of our new structure. We will also need a couple of function block declarations:
```js
VAR
  sendData      : DUT_Message;
  bSend         : BOOL;
  sTopic        : STRING;

  fbGetSysId    : FB_GetSystemId;
  fbMqttClient  : FB_IotMqttClient := (
                      sHostName := 'iot.beckhoff.us',
                      nHostPort := 1883,
                      sTopicPrefix := 'nem_2024/');
END_VAR
```

In the body of `MAIN`, we will create a conditional to explicitly publish a message to our MQTT broker:
```js
// publish message
IF bSend THEN
  sendData.Id := sendData.Id + 1;
  sendData.Message := 'Hello from NEM 2024!'; // put your message here!
  sTopic := GUID_TO_STRING(fbGetSysId.stSystemId);
  fbMqttClient.Publish(sTopic, ADR(sendData), SIZEOF(sendData));
  bSend := FALSE;
END_IF

// sync fb calls
fbGetSysId(bExecute:=TRUE);
fbMqttClient.Execute(TRUE);
```

Activate and run the PLC project. Before we toggle our send bit, open up the MQTT desktop client and create a connection to the broker. If we subscribe to the `nem_2024/#` path, we will receive all messages from all sub-topics. Toggle the send bit, and we should start to see messages coming in with new topics created for each sender's system GUID.

<a id="json"></a>

### 4. JSON

We are currently sending the message as a fixed-size binary data format. We may still be able to read the string data, but it is not cleanly formatted or digestible to subscribers who don't have the `DUT_Message` type information. Luckily for us, TwinCAT includes straight-forward tooling for *serializing* data types to human (and machine) readable JSON (JavaScript Object Notation).

Why JSON? JSON is a great data exchange format utilized all over the web. An object serialized to JSON provides *just enough* metadata so that it is both human readable, and easily *deserialized* back into a usable object in almost any programming language (TwinCAT included).

Add a new function `TO_JSON` to the project. Return type will be `STRING(255)`, and we will make our function generic by accepting the `ANY` type as input.

Declaration:
```js
FUNCTION TO_JSON : STRING(255)
VAR_INPUT
  Input           : ANY;
END_VAR
VAR
  sTypeName       : STRING;
  sRes            : STRING(255);
  fbJson          : FB_JsonSaxWriter;
  fbJsonDataType  : FB_JsonReadWriteDataType;
END_VAR
```
Body:
```js
sTypeName := fbJsonDataType.GetDatatypeNameByAddress(TO_UDINT(Input.diSize), Input.pValue);
fbJsonDataType.AddJsonValueFromSymbol(fbJson, sTypeName, TO_UDINT(Input.diSize), Input.pValue);
fbJson.CopyDocument(sRes, SIZEOF(sRes));
TO_JSON := sRes;
```
Quite nice that we can go from any PLC data structure to a JSON string in just a few lines of code! 

>There are a **lot** more options in the Tc3_JsonXml library, too! You can fully customize your JSON/XML output. For example, the naming of JSON keys do not have to match the structure member names exactly. There is even a JsonSax*Pretty*Writer block that formats the JSON output for readability (we'll save the bytes for now). Have a look at the infosys documentation if you are looking for more flexibility.

We can revise our send logic to use this new function and generate a JSON string to send instead of binary data:
```js
// ...
sJson := TO_JSON(sendData);
fbMqttClient.Publish(sTopic, ADR(sJson), LEN2(ADR(sJson)));
// ...
```


> Note that you will have to declare a new `STRING(255)` variable `sJson`, and we are using `LEN2()` to send the **exact** length of the string instead of the allocated size; `STRING(255)` = 256 bytes.

Check back with the desktop client, and you should be able to see JSON messages coming in:
```json
{ "Id": 1, "Message": "Hello from NEM 2024!" }
```

<a id="subscribing"></a>

### 5. Subscribing

We have been using the desktop client to subscribe to a topic and listen for messages, but TwinCAT is just as capable for this functionality.

Add a few declarations to `MAIN`:
```js
bSubscribe      : BOOL;
sReceived       : STRING(255);
sRecTopic       : STRING;
fbMessageQueue  : FB_IotMqttMessageQueue;
fbMessage       : FB_IotMqttMessage;
```

and the following to the body:
```js
// subscribe
IF bSubscribe THEN
  fbMqttClient.ipMessageQueue := fbMessageQueue;
  fbMqttClient.Subscribe(sTopic:='#'); // listen for all nem_2024 messages
  bSubscribe := FALSE;
END_IF

// listen for messages
IF fbMessageQueue.nQueuedMessages > 0 AND fbMessageQueue.Dequeue(fbMessage) THEN
  MEMSET(ADR(sReceived), 0, SIZEOF(sReceived)); // clear receive buffer
  fbMessage.GetPayload(pPayload:=ADR(sReceived), nPayloadSize:=SIZEOF(sReceived), FALSE);
  fbMessage.GetTopic(ADR(sRecTopic), SIZEOF(sRecTopic));
END_IF
```

>Note that we are also calling the `fbMessage.GetTopic()` method. We are subscribed to a wildcard path (nem_2024/**#**), but we can still get the exact topic to which the message was published.

The last piece would be to convert the incoming message from a JSON string *back* to our `DUT_Message` type. We can write a similar little generic helper function to make this easy.

Declaration:
```js
FUNCTION FROM_JSON : BOOL
VAR_INPUT
  sJson     : STRING;
  Output    : ANY;
END_VAR
VAR
  sTypeName       : STRING;
  sRes            : STRING(255);
  fbJsonDataType  : FB_JsonReadWriteDataType;
END_VAR
```

Body:
```js
sTypeName := fbJsonDataType.GetDatatypeNameByAddress(TO_UDINT(Output.diSize), Output.pValue);
fbJsonDataType.SetSymbolFromJson(sJson, sTypeName, TO_UDINT(Output.diSize), Output.pValue);
FROM_JSON := TRUE;
```

And finally, declare a new structure instance to hold the receieved data, and revise the listening logic:
```js
receiveData		: DUT_Message;
```
```js
//...
// listen for messages
IF fbMessageQueue.nQueuedMessages > 0 AND fbMessageQueue.Dequeue(fbMessage) THEN
  // ...
  FROM_JSON(sReceived, receiveData);
END_IF
```

And we should see our received JSON string deserialized into the receiveData instance of `DUT_Message`.

<a id="summary"></a>

### 6. Summary

In this lab we have explored the technical details of MQTT, but more importantly, the broad advantages of a publisher/subscriber messaging model. We were all able to interact with the broker and exchange information as publishers and subscribers, without any security or addressing considerations. MQTT provides useful application layer so that fewer protocol, communication and security details are required to get things talking.

### Bonus (Time permitting)

The IoT libraries are fine as is, but maybe we can further simplify or improve the experience with a nice wrapper Interface/FB.

- What properties and methods might we have in our interface?
- What strategies should we employ for receiving messages? Remember we are subscribed to a topic and messages come into a queue asynchronously.
