> For the complete documentation index, see [llms.txt](https://docs.channex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.channex.io/application-documentation/api-key-access.md).

# API Key Access

If you want to connect an application like a Property Management System (PMS) or Revenue Management (RMS) or similar.

You will need to use the API key

## Setup an API Key

This feature is not available for all Users by default, to enable it you will need to have an active subscription.

If you are not the billing account owner you will not have access to this

**In Staging Server it is available to all users**

If you have just subscribed and it does not show try refresh browser or logout and back in.

In the [Organisation Page](https://staging.channex.io/organization/api-keys) you will see a section: `API Keys`.

![API Key management interface](/files/-MfaKWZZTTMOanKPJZbN)

Press `Create new API Key`, fill the API Key name and press `Create` to generate a new API Key.

You can make a API key for all properties or select some properties only.

<figure><img src="/files/4BKQZL3nO0zNglFp48O1" alt=""><figcaption></figcaption></figure>

After that, you should see this next message:

![Generated API Key Interface](/files/-MfaMKkMnENBR1b57f7f)

{% hint style="warning" %}
Please, copy the API Key and keep it in a safe place.\
The API Key will only be shown once.\
If you lose the API Key, you can generate a new one.an
{% endhint %}

## API Key for 1 or more Properties

Sometimes you need to share only 1 or 2 properties instead of all properties in your account, this is useful for connecting a 3rd party system like a Revenue Management application

<figure><img src="/files/GLfI5B4nZQygYWiYtESU" alt=""><figcaption></figcaption></figure>

Just unselect the "Access to all properties" box and you will get a list of properties to select. The API will only be allowed to access the selected properties

##

## API Key Usage

To send an API requests using the API Key, you should pass it as `user-api-key` header into request.

```
GET /api/v1/properties/ HTTP/1.1
Host: staging.channex.io
Content-Type: application/json
user-api-key: uU08XiMgk8a7CrY4xUjAReUIuTrn83R123adaVb8Tf/qMcVTEgriuJhXWs/1Q1P
```

## Revoke an API Key

Sometimes, an API Key can get compromised. This can happen for many different reasons - forgetting the key at a git repo or something else. If you think your API Key is compromised you can revoke that key.

At your User Profile, find your key at list and press `Actions` button, choose `Withdraw` action and confirm action.

The API key will still be listed and not removed, just disabled.

![Revoke API Key Interface](/files/-MfaO6AR3EYWc9ePaT3n)

## What is possible via the API Key

Using the key you will get access to the same powers as the user itself.

If you made an API key for a specific property then you only can access those properties selected.
