> For the complete documentation index, see [llms.txt](https://docs.channex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.channex.io/channel-mapping-guides/booking.com.md).

# Booking.com

## Request connection to Channex.io in booking extranet

Login to the admin for the property here: <https://account.booking.com/>

{% hint style="info" %}
This step is best done by the property since booking.com have 2 step security with passcodes sent to the phone.
{% endhint %}

![](/files/-M9NC6MDUth4vnX1nrii)

1. Copy the property code at the top of the navigation, you will need this later inside Channex to connect the account
2. Click on Account > Connectivity Provider

### Choose Provider Screen

![](/files/-M9NDDDlLpLsecvv0AhK)

Click on "Search"

![](/files/-M9NDs_jJo8aEox7v1CW)

Type "Channex" and it will find Channex.io on the list.

{% hint style="warning" %}
You have to type the whole word "Channex" since it wont find it otherwise.
{% endhint %}

![](/files/-M9NEay24ArscexPIH5h)

Once channex is selected on the list it will show the summary box, just click "Next"

### Agree the XML Service Agreement

![](/files/-M9NFT-ESq_J9jVk4XKh)

Click on the checkbox to agree the terms and conditions and then the "Yes, I accept" button.

No other things needs to be done or completed on this form

![](/files/-M9NFpI671WZAMqnblTf)

Now you will be in a waiting status, until Channex accepts the connection

{% hint style="info" %}
You can go to map the property in Channex immediately even though Channex has not accepted the property yet. But at this stage you cannot go live (just mapping)
{% endhint %}

{% hint style="danger" %}
Warning: Once you connect a channel manager to Booking.com you should check the settings of all derived rates to make sure the min stay or other settings are correct as they might be changed automatically by booking.com.
{% endhint %}

## Create Booking.com Channel in Channex

Once booking.com connectivity provider is completed or in waiting mode you can start the connection and mapping. If you try before you will get an error since the property has not provided you access yet.

In Channex to go the channels page: <https://app.channex.io/channels>

![](/files/-M9NGnivFrfmS4UwJrDF)

Click on the "Create" button to start a new connection

![](/files/-M9NH2qWaOSwUEhSjj9d)

Select the channel "Booking.com"

![](/files/-M9NHH-CK8UHl7D6x4Ka)

Group: if you have more than 1 group then please select the correct group where the property is located.

Title: Custom text to call this connection

Property: Choose the correct property from the list

Hotel ID: This is where you enter the property ID of the property from booking.com.

{% hint style="info" %}
You can find property ID in booking.com extranet at the top of the screen next to the property name.
{% endhint %}

Test Connection Button - Checks if the property is accessible to map

Once the settings are filled and the test gives a positive result we can move onto the mapping

## Advanced Settings

<figure><img src="/files/QQRy48pnwYhN9hB5G60C" alt=""><figcaption></figcaption></figure>

Optional settings if you would like you booking to be modified for any of these events.

VCC - If the VCC Changes

Payout - If the payour amount changes

Payout Method - If payout is changed Example: VSS to Bank Transfer

VCC Balance - If VCC balance changes

VCC Fees Payout - If Payment fees Cahnge

{% hint style="info" %}
Note: Some of these may create a lot of booking modifications. Example: VCC balance changes if the currency is different to the booking (Currency changes)
{% endhint %}

## Mapping booking.com

Mapping is important that all rate plans be mapped, any non mapped rate plans or rooms will cause issues later. If a rate or room is not required anymore then please ask the property to delete it.

![](/files/-M9NIdzvM864Ha28za-a)

Notes:

On the left side you will see all the rooms and rates on the channel, and on the right side you can see what is mapped.

The Booking.com room type names are their default name, if you have added a custom name in the extranet then they are not visible. This is why we have also given the Room ID after the text.

{% hint style="info" %}
Some properties like apartments can have multiple room types of the same name. It will be hard to know how to map unless you look at the ID and match to room internally on the extranet.
{% endhint %}

Once mapping is completed please save the channel by pressing the save button at the bottom

## Occupancy Based Mapping

Booking can support occupancy based prices also, if this is supported then you can map each occupancy of a room type

![](/files/-MEqhn4qhxn3ncBPBZPD)

**Primary Rate** - This will be the rate plan that sends the restrictions such as min stay or stop sell. Since it is only one rate plan in booking.com.

![](/files/-MEqhrhwQ1I1LNu-2amK)

You can move your mouse over the other occupancy options and you can change the primary rate.

## Activate the Connection

![](/files/-M9OJJmfZDW7KeESu400)

To activate please click on "Actions" button on the channel and select "Activate"

## Pull Future Reservations

You can also pull all future reservations if you require from booking.com channel. This is useful in many instances especially with a new PMS setup.

{% hint style="warning" %}
Importing bookings will not affect the availability in Channex.

The data you get from imported bookings will lack some details compared to normal booking, it will not include

* Taxes of Fees
* Personal Details like email, address, telephone etc.
* Commission details
* Credit Card Details
  {% endhint %}

## Derived Rate Plans inside booking.com

Derived should be not mappable inside Channex, if they have some or make new ones inside booking it should work similar to promotions where it does not need mapping and the bookings will come back fine.

However, in some cases there are old versions of derived rates that will show in Channex mapping as mappable rates. There are 2 solutions to this:

1. Map all rates even the derived ones, if you don't map then you will get unmapped booking errors
2. Ask the hotel to delete the derived rates inside booking.com and then they can make them again new. The new versions will not show as mappable and will work as expected.
