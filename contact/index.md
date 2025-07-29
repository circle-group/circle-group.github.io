---
title: Contact
nav:
  order: 5
  tooltip: Email, address, and location
---

# {% include icon.html icon="fa-regular fa-envelope" %}Contact

We are located at the Huxley Building of Imperial College London. For any inquiries: 

{%
  include button.html
  type="email"
  text="tbirdal@imperial.ac.uk"
  link="tbirdal@imperial.ac.uk"
%}
{%
  include button.html
  type="address"
  tooltip="Our location on Google Maps for easy navigation"
  link="https://maps.app.goo.gl/zZwtJGWiwRiS5rMM8"
%}

{% include section.html %}

{% capture col1 %}

{%
  include figure.html
  image="images/huxley.jpg"
  caption="Huxley building"
%}

{% endcapture %}

{% capture col2 %}

{%
  include figure.html
  image="images/logml.jpeg"
  caption="Royal Albert Hall (@LOGML)"
%}

{%
  include figure.html
  image="images/location.jpg"
  caption="Our location"
%}

{% endcapture %}

{% include cols.html col1=col1 col2=col2 col2=col3 %}

{% include section.html dark=true %}
