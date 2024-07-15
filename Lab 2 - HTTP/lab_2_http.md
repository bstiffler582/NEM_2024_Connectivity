## Connectivity Lab 2 - HTTP/REST

### Contents
1. [Introduction](#introduction)
2. [Dependencies](#dependencies)
3. [Auth Flow](#auth_flow)
4. [TwinCAT Auth Request](#twincat_auth)
5. [TwinCAT Recipe Request](#twincat_recipe)
6. [Summary](#summary)

---

<a id="introduction"></a>

### 1. Introduction

The ability to make HTTP requests right from the TwinCAT runtime opens up a lot of software interfacing opportunities. RESTful APIs are a very common way for organizations to provide secure access to priviledged information. Introducing any kind of middleware complicates the transaction and potentially exposes the data over insecure channels. In this lab, we will interact with a demo API using a common authentication flow to retrieve sensitive information directly into the PLC. In this case, the sensitive information is going to be **super secret recipe** parameters.

<a id="dependencies"></a>

### 2. Dependencies

This lab uses TwinCAT 3.1 and the TF6760 IoT HTTPS/REST library. If you are using 4024, the required libraries are already installed and available. If using 4026, you will need to add the TF6760 package via the Package Manager.

<a id="auth_flow"></a>

### 3. Auth Flow

The following graphic illustrates the authentication flow we will implement from the PLC program:

<img src="img_authflow.png">

> credit: vmware.com

In our case, the PLC program is the consuming application. We will use two separate test endpoints to act as the authorization server and the resource (recipe) server. 
```
Authorization:  https://putsreq.com/6h0nzE2faGfK23K9UzFV
Resource:       https://putsreq.com/RlFsRfglQsarf07mbaSz
```

Let's use our cURL command (`Invoke-WebRequest`) in PowerShell to test this out. For starters, we can just try to grab something from the Resource endpoint. As part of our request, we will have to specify a `recipeId` to retrieve from the resource server. We can do this with a simple parameter right in the URL: 

<span style="color:purple">putsreq.com/RlFsRfglQsarf07mbaSz</span>?<span style="color:green">recipeId=1</span>

 So our PowerShell command will be:

```ps
curl https://putsreq.com/RlFsRfglQsarf07mbaSz?recipeId=1
```

Unsurprisingly, the response is <span style="color:red">(401) Unauthorized</span>, because we have not attached an Access Token to authorize our request. We must follow the flow and supply the authorization server with our Client Id and Client Secret to get an Access Token in return.

```ps
$auth = @{
  client_id = "nem_2024"
  client_secret = "super_secret_client_secret"
}
curl https://putsreq.com/6h0nzE2faGfK23K9UzFV `
  -Method POST `
  -ContentType "application/json" `
  -Body ($auth | ConvertTo-JSON -Compress)
```
We pass the client credentials (`client_id` and `client_secret`) into the body of a `POST` request to our authorization endpoint. If the credentials are valid, our client is authenticated and the endpoint returns an Access Token:

```ps
Content           : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9__NEM2024
```

> For simplicity, we are just returning the Access Token value. In reality, it is typically accompanied by a few other fields in JSON format, like token 'type' and expiration date.

From here, our Access Token is attached via a Header field to each subsequent request to the Resource server. This will authorize our client:

```ps
curl https://putsreq.com/RlFsRfglQsarf07mbaSz?recipeId=1 `
  -Headers @{ Authorization = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9__NEM2024' }
```

And now instead of <span style="color:red">401</span>, we should receive a <span style="color:green">200</span> response containing recipe data:

```ps
Content : {
            "id": 1,
            "ag1_speed": 80,
            "mix_time": 300,
            "temp_sp": 45
          }
```

We have now demonstrated our application Auth flow using PowerShell's cURL equivalent, `Invoke-WebRequest` (the `curl` command we've been using is just a shortcut/alias). The last piece is to do this in TwinCAT.

> Note on 'Auth': You may think the terms "authentication" and "autorization" have been used interachangeably here, but be careful - they are different things in this context. Authentication is confirming the identity of a given entity, while Authorization is the act of verifying and controlling the entity's access to certain resources.
>
> Supplying our client credentials (id and secret) to the Authorization Server is an act of *Authentication*. When we attach our Access Token to the Resource Server, it will *Authorize* our access to the information therein. It is best summarized as "who are you?" (authentication) versus "what permissions do you have?" (authorization).
>
> You will see the shorthand 'Auth' used frequently, because many times we are dealing with both terms.

<a id="twincat_auth"></a>

### 4. TwinCAT Auth Request

Create a fresh TwinCAT / PLC Project and add the following PLC library references:
- Tc2_Utilities
- Tc3_IotBase
- Tc3_JsonXml

Port over the `TO_JSON` and `FROM_JSON` functions we created in the MQTT lab.

Luckily, from our preliminary testing we were able to learn the format of our send and receive messages. Let's create a type to correspond with our auth message data:

```js
TYPE DUT_ApiAuth :
STRUCT
  client_id         : STRING(255);
  client_secret     : STRING(255);
END_STRUCT
END_TYPE
```

We can also go ahead an create a new instance of our ApiAuth type with the `client_id` and `client_secret` fields populated.

```js
PROGRAM MAIN
VAR
  apiAuth           : DUT_ApiAuth := (
                        client_id:='nem_2024', 
                        client_secret:='super_secret_client_secret'
                      );
END_VAR
```

> We are all using the same client_id and client_secret values for this demo. In reality (and for obvious security reasons), each consuming client will have unique values for these. It is somewhat analogous to a username/password, but for individual *clients* instead of individual *users*.

Now add the following additional variables:

```js
httpClient          : FB_IotHttpClient := (
                        sHostName:='putsreq.com',
                        nHostPort:=443,
                        bKeepAlive:=FALSE
                      );

authRequest         : FB_IotHttpRequest;

nState              : DINT;   // program state
nLastResponse       : DINT;   // last http response code
sSendBuffer         : STRING(255);
sRecBuffer          : STRING(255);
sAccessToken        : STRING(255);
```

Now we will build a state machine to handle building the request, sending it, and processing the results.

```js
CASE nState OF
  // idle
  0:
  // auth request
  10:
  11:
  // recipe request
  20:
  21:
END_CASE

httpClient.Execute();
```
In the idle state, we are just setting a client property and clearing out the received buffer. If we do not have a specific certificate to exchange with the endpoint, we will need to set this `bNoServerCertCheck` property to `TRUE`.
```js
0:
  httpClient.stTLS.bNoServerCertCheck := TRUE;
  MEMSET(ADR(sRecBuffer), 0, SIZEOF(sRecBuffer));
```
In the first state of our Auth flow, we prep and send the request. Primarily we are serializing the client credential stucture to JSON, and calling our request FBs `SendRequest` method.
```js
10:
  MEMSET(ADR(sAccessToken), 0, SIZEOF(sAccessToken));
  sSendBuffer := TO_JSON(apiAuth);
  authRequest.sContentType := 'application/json';
  IF authRequest.SendRequest('/6h0nzE2faGfK23K9UzFV', httpClient, ETcIotHttpRequestType.HTTP_POST, ADR(sSendBuffer), LEN2(ADR(sSendBuffer))) THEN
    nState := 11;
  END_IF
```
Finally, we read and process the response data. If the request is successful, we take the response and build our `sAccessToken` string.
```js
11:
  IF NOT authRequest.bBusy THEN
    nLastResponse := authRequest.nStatusCode;
    IF authRequest.nStatusCode = 200 THEN
      authRequest.GetContent(ADR(sRecBuffer), SIZEOF(sRecBuffer), FALSE);
      sAccessToken := CONCAT('Bearer ', sRecBuffer);
      nState := 0;
    ELSE
      // failed
      nState := 0;
    END_IF
  END_IF
```

<a id="twincat_recipe"></a>

### 5. TwinCAT Recipe Request

If we can successfully retrieve the Access Token and it is being loaded into `sAccessToken`, we can retrieve the recipe data. First, create a type to hold the response message:

```js
TYPE DUT_ApiRecipe :
STRUCT
  id                : DINT;
  ag1_speed         : DINT;
  mix_time          : DINT;
  temp_sp           : REAL;
END_STRUCT
END_TYPE
```

> Note: We create the type with member names to match what we expect our endpoint to return. As mentioned in the previous lab, these don't necessarily have to be the same. It just makes the JSON handling easier.

Then we will need to add some additional declarations in `MAIN`:
```js
  recipeRequest     : FB_IotHttpRequest;
  header            : FB_IotHttpHeaderFieldMap;
  sRecipeUrl        : STRING;
  nRecipeId         : DINT;
  apiRecipe         : DUT_ApiRecipe;
```

The proceeding steps to get the recipe data are similar to the Auth request, but with some notable differences:
- We are issuing a `GET` request instead of a `POST` request
- We need to attach our Access Token to the header of the request
  - In the form of a key:value pair; `Authorization`:`Bearer <token>`
- We need to supply a URL parameter for the `recipeId`
- The resulting data should be deserialized from JSON into the `DUT_ApiRecipe` type

```js
20:
  sRecipeUrl := CONCAT('/RlFsRfglQsarf07mbaSz?recipeId=', TO_STRING(nRecipeId));
  header.AddField('Authorization', sAccessToken, FALSE); 
  IF recipeRequest.SendRequest(sRecipeUrl, httpClient, ETcIotHttpRequestType.HTTP_GET, 0, 0, header) THEN
    nState := 21;
  END_IF
```
```js
21:
  IF NOT recipeRequest.bBusy THEN
    nLastResponse := recipeRequest.nStatusCode;
    IF recipeRequest.nStatusCode = 200 THEN
      recipeRequest.GetContent(ADR(sRecBuffer), SIZEOF(sRecBuffer), FALSE);
      FROM_JSON(sRecBuffer, apiRecipe);
      nState := 0;
    ELSE
      // failed
      nState := 0;
    END_IF
  END_IF
```

Now to follow the whole workflow:
- Set `nState` to `10` to retrieve the access token
- Set `nRecipeId` to any value `1 thru 7`
- Set `nState` to `20` to retrieve the recipe with the selected Id

Troubleshooting:

- `401`: Make sure the access token is being loaded correctly 
  - `sAccessToken` = `'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9__NEM2024'`
- `401`: Make sure header (`FB_IotHttpHeaderFieldMap`) is being attached to request
- `404`: `nRecipeId` value is `1 thru 7`
- `400`: `client_id` and `client_secret` are appropriately serialized to JSON and included in the body of the auth `POST` request
- No response: Check endpoint addresses
  - `sHostName` should not have `https://` prefix
  - `sUri` of `SendRequest` method should start with `/`

<a id="summary"></a>

### 6. Summary

In this lab we have practiced bi-directional HTTP communication via GET and POST requests, while also learning the advantages of being able to handle these functions right from the PLC. The demo application followed a popular authorization scheme in order to illustrate common API practices, while consuming data from these systems in a RESTful and secure manner.