> For the complete documentation index, see [llms.txt](https://docs.channex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.channex.io/channel-mapping-guides/vrbo.md).

# VRBO

## Current Problems & Issues

Right now we have a few issues which are being worked on:

* Sometimes the channel will disconnect automatically (You will get email about this if it happens) Usually it is because the user has changed their user password.

## Supported Functionality

We support the following:

* ARI updates (Availability, Rates and Restrictions)
* Get Bookings (New, Modified and Cancelled)
* Currency Supported: **USD, CAD, EUR, AUD, NZD, JPY, SGD, BRL, MXN and GBP**

Not supported yet:

* Messages
* Reviews

## Make sure the VRBO account is not API connected to previous software

<figure><img src="/files/hXJidmvnFKJ8qVXSMH3N" alt=""><figcaption></figcaption></figure>

If the account was previously connected to a PMS for XML API then you will see something like this. The owner or property manager will need to ask VRBO support to convert the account back into a normal account (without channel manager)

Once this is completed it can be ready to connect. Connecting while still connected to previous software can make issues.

## Make sure you remove any ical connections

Leaving ical connected from Airbnb or another PMS will overwrite anything that Channex sends. You should remove ical connections first.

## Instructions for VRBO if it is connected to a channel manager already

"Please can you disconnect my account from my current channel manager, I will control the extranet manually"

They should disconnect the current channel manager and convert the account to a normal one with payments by VRBO.

## How to Connect

## Create the VRBO Channel

Go to the channels tab and click on "Create"

Select **VRBO** as the channel

Title - Enter the name you would like here to describe this connection

Group: Choose the correct group of which property you need to connect.

Affected Property: Choose the properties you wish to connect from Channex

Username: This is the VRBO username

Password: The password used to login

Authenticate: This button will start the connection

Test Connection - This button will check if the connection is a success.

**The Process:**

* Enter the username and password into the provided fields of VRBO channel
* Press Authenticate button (not test connection)
* (If Required) Enter the 2 factor SMS code into provided field. This is a code sent to the account owner
* Press Test Connection to see if it is successful
* if its working the mapping page should show listings, if not then please get in touch

## Mapping

<figure><img src="/files/OFWNzdeyKpmRpznNiDEX" alt=""><figcaption></figcaption></figure>

Mapping page will show all listings to connect. Please map a room and rate to the listings you wish to connect.

Once everything is mapped activate the channel
